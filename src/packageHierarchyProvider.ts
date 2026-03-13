import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Represents a package found in the workspace
 */
export interface PackageInfo {
    /** Package name from package.json (e.g., "@sage/xtrem-finance-data") */
    name: string;
    /** Absolute path to the package directory */
    packagePath: string;
    /** workspace:* entries from the `dependencies` field */
    workspaceRegularDeps: string[];
    /** workspace:* entries from the `devDependencies` field */
    workspaceDevDeps: string[];
}

/**
 * Tree item for the packages hierarchy view
 */
export class PackageTreeItem extends vscode.TreeItem {
    constructor(
        public readonly packageInfo: PackageInfo,
        collapsibleState: vscode.TreeItemCollapsibleState,
        /** true when this item represents a dependency (child node) */
        public readonly isDependency: boolean = false,
        /** Parent item in the tree (undefined for root items) */
        public readonly parent: PackageTreeItem | undefined = undefined,
    ) {
        super(packageInfo.name, collapsibleState);
        // Stable, path-based ID so VS Code can match items across getChildren() calls
        this.id = parent ? `${parent.id}/${packageInfo.name}` : packageInfo.name;
        this.tooltip = packageInfo.packagePath;
        this.description = isDependency ? "workspace:*" : undefined;
        this.iconPath = new vscode.ThemeIcon(
            isDependency ? "package" : "folder-library",
        );
        this.contextValue = "packageItem";

        // Allow clicking to open the package.json
        const pkgJsonPath = path.join(packageInfo.packagePath, "package.json");
        this.command = {
            command: "vscode.open",
            title: "Open package.json",
            arguments: [vscode.Uri.file(pkgJsonPath)],
        };
    }
}

/**
 * Tree data provider for the packages hierarchy view.
 *
 * Reads the workspace root package.json for the `workspaces` property,
 * traverses the listed paths to discover sub-packages, and builds a tree
 * based on `workspace:*` dependencies between them.
 *
 * Supports two view modes:
 *
 *   "flat" – every workspace package appears at the root level.
 *            Children show the direct `workspace:*` dependencies of each
 *            package (i.e. what this package depends on), recursively
 *            expandable.  A package can appear both at the root and as a
 *            child of its dependents.
 *            Example: P31 → P21 → P11
 *
 *   "tree" – bottom-up / "who uses me?" view.
 *            Root packages are those that have no `workspace:*` dependencies
 *            themselves (the foundational packages).  Children show which
 *            other workspace packages depend on the parent.  A package can
 *            appear as a child of every package it depends on.
 *            Example: P11 → [P21 → [P31], P22]
 *                     P12 → [P22]
 */
export class PackageHierarchyProvider
    implements vscode.TreeDataProvider<PackageTreeItem>
{
    private _onDidChangeTreeData = new vscode.EventEmitter<
        PackageTreeItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** All packages found in the workspace, keyed by package name */
    private packageMap: Map<string, PackageInfo> = new Map();
    /** Root packages (top-level entries from the workspaces glob) */
    private rootPackages: PackageInfo[] = [];
    /**
     * Reverse dependency map: for each package name, the list of workspace
     * packages that declare it as a `workspace:*` dependency.
     */
    private reverseDepsMap: Map<string, PackageInfo[]> = new Map();

    /** Current display mode */
    private viewMode: "flat" | "tree" = "flat";

    /** Which dependency types to include when computing workspace edges */
    private depTypeFilter: "dependencies" | "devDependencies" | "both" = "dependencies";

    /** Whether the package filter (current-file branch only) is active */
    private packageFilterActive = false;
    /** Name of the package to filter on (set from the active editor) */
    private filteredPackageName: string | null = null;

    private workspaceRoot: string;
    private outputChannel: vscode.OutputChannel | undefined;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.workspaceRoot =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
        this.outputChannel = outputChannel;
    }

    private log(message: string): void {
        this.outputChannel?.appendLine(`[PackageHierarchy] ${message}`);
    }

    // -------------------------------------------------------------------------
    // TreeDataProvider implementation
    // -------------------------------------------------------------------------

    getTreeItem(element: PackageTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PackageTreeItem): vscode.ProviderResult<PackageTreeItem[]> {
        if (!element) {
            // Root level: depends on view mode
            const baseRoots =
                this.viewMode === "tree"
                    ? this.computeTreeRoots()
                    : this.rootPackages;

            // Apply package filter at root level
            const roots =
                this.packageFilterActive && this.filteredPackageName
                    ? this.viewMode === "flat"
                        ? baseRoots.filter(
                              (pkg) => pkg.name === this.filteredPackageName,
                          )
                        : baseRoots.filter((pkg) =>
                              this.packageLeadsToFiltered(pkg.name, new Set()),
                          )
                    : baseRoots;

            return this.sortPackages(roots).map((pkg) =>
                this.createTreeItem(pkg, false, undefined),
            );
        }

        if (this.viewMode === "tree") {
            // Tree mode children: packages that depend on this one (reverse deps)
            const allDependents = this.reverseDepsMap.get(element.packageInfo.name) ?? [];

            // In tree mode with filter: only keep children on the path to the filtered package
            const dependents =
                this.packageFilterActive && this.filteredPackageName
                    ? allDependents.filter((pkg) =>
                          this.packageLeadsToFiltered(pkg.name, new Set()),
                      )
                    : allDependents;

            return this.sortPackages(dependents).map((pkg) =>
                this.createTreeItem(pkg, true, element),
            );
        }

        // Flat mode children: workspace:* dependencies of this package
        const deps = this.getEffectiveDeps(element.packageInfo)
            .map((depName) => this.packageMap.get(depName))
            .filter((p): p is PackageInfo => p !== undefined);

        return this.sortPackages(deps).map((pkg) =>
            this.createTreeItem(pkg, true, element),
        );
    }

    getParent(element: PackageTreeItem): PackageTreeItem | undefined {
        return element.parent;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Reload packages from disk and refresh the tree */
    async refresh(): Promise<void> {
        await this.loadPackages();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Toggle between "flat" and "tree" view modes.
     * Returns the new mode.
     */
    toggleViewMode(): "flat" | "tree" {
        this.viewMode = this.viewMode === "flat" ? "tree" : "flat";
        this._onDidChangeTreeData.fire();
        return this.viewMode;
    }

    /** Current view mode */
    getViewMode(): "flat" | "tree" {
        return this.viewMode;
    }

    /**
     * Cycle through dependency type filters: dependencies → devDependencies → both → …
     * Rebuilds the reverse dependency map and fires a tree refresh.
     * Returns the new filter value.
     */
    cycleDepTypeFilter(): "dependencies" | "devDependencies" | "both" {
        if (this.depTypeFilter === "dependencies") {
            this.depTypeFilter = "devDependencies";
        } else if (this.depTypeFilter === "devDependencies") {
            this.depTypeFilter = "both";
        } else {
            this.depTypeFilter = "dependencies";
        }
        this.rebuildReverseDepsMap();
        this._onDidChangeTreeData.fire();
        return this.depTypeFilter;
    }

    /** Current dependency type filter */
    getDepTypeFilter(): "dependencies" | "devDependencies" | "both" {
        return this.depTypeFilter;
    }

    /**
     * Toggle the package filter on/off.
     * Returns the new state (true = active).
     */
    togglePackageFilter(): boolean {
        this.packageFilterActive = !this.packageFilterActive;
        this._onDidChangeTreeData.fire();
        return this.packageFilterActive;
    }

    /** Whether the package filter is currently active */
    isPackageFilterActive(): boolean {
        return this.packageFilterActive;
    }

    /**
     * Set the package name to filter on (derived from the active editor file).
     * Triggers a tree refresh only when the filter is currently active.
     */
    setFilteredPackage(packageName: string | null): void {
        if (this.filteredPackageName === packageName) {
            return;
        }
        this.filteredPackageName = packageName;
        if (this.packageFilterActive) {
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * Return the PackageInfo whose directory contains the given file path,
     * or undefined if no match is found.
     */
    findPackageForFile(filePath: string): PackageInfo | undefined {
        let best: PackageInfo | undefined;
        let bestLen = 0;

        for (const pkg of this.packageMap.values()) {
            const pkgPath = pkg.packagePath + path.sep;
            if (
                filePath.startsWith(pkgPath) &&
                pkg.packagePath.length > bestLen
            ) {
                best = pkg;
                bestLen = pkg.packagePath.length;
            }
        }

        return best;
    }

    /** Get all root-level PackageTreeItems (used for reveal) */
    getRootItems(): PackageTreeItem[] {
        const roots =
            this.viewMode === "tree"
                ? this.computeTreeRoots()
                : this.rootPackages;
        return this.sortPackages(roots).map((pkg) =>
            this.createTreeItem(pkg, false, undefined),
        );
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * In "tree" mode, compute the packages that should appear at the root
     * level: those that have no `workspace:*` dependencies themselves
     * (i.e. foundational packages that other packages depend on but which
     * do not depend on any other workspace package).
     */
    private computeTreeRoots(): PackageInfo[] {
        return this.rootPackages.filter((pkg) => this.getEffectiveDeps(pkg).length === 0);
    }

    private createTreeItem(
        pkg: PackageInfo,
        isDependency: boolean,
        parent: PackageTreeItem | undefined,
    ): PackageTreeItem {
        const hasChildren =
            this.viewMode === "tree"
                ? (this.reverseDepsMap.get(pkg.name)?.length ?? 0) > 0
                : this.getEffectiveDeps(pkg).some((d) => this.packageMap.has(d));

        let collapsible: vscode.TreeItemCollapsibleState;
        if (!hasChildren) {
            collapsible = vscode.TreeItemCollapsibleState.None;
        } else if (
            this.packageFilterActive &&
            this.viewMode === "flat"
        ) {
            // In flat mode with filter active, fully expand the filtered branch
            collapsible = vscode.TreeItemCollapsibleState.Expanded;
        } else {
            collapsible = vscode.TreeItemCollapsibleState.Collapsed;
        }

        return new PackageTreeItem(pkg, collapsible, isDependency, parent);
    }

    /** Sort a list of PackageInfo items by name (locale-aware, ascending). */
    private sortPackages(packages: PackageInfo[]): PackageInfo[] {
        return [...packages].sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Return the effective workspace deps for a package based on the current
     * `depTypeFilter`:
     *   "dependencies"    → workspaceRegularDeps
     *   "devDependencies" → workspaceDevDeps
     *   "both"            → union of both lists
     *
     * A package appearing in both `dependencies` and `devDependencies` of the
     * same package.json would be a malformed manifest, so deduplication is not
     * needed in the common case and we avoid the overhead of a Set.
     */
    private getEffectiveDeps(pkg: PackageInfo): string[] {
        switch (this.depTypeFilter) {
            case "dependencies":
                return pkg.workspaceRegularDeps;
            case "devDependencies":
                return pkg.workspaceDevDeps;
            case "both":
                return [...pkg.workspaceRegularDeps, ...pkg.workspaceDevDeps];
        }
    }

    /**
     * Rebuild `reverseDepsMap` from the already-loaded `packageMap` using the
     * current `depTypeFilter`.  Called after loading and after each filter change.
     */
    private rebuildReverseDepsMap(): void {
        this.reverseDepsMap.clear();
        for (const pkg of this.packageMap.values()) {
            for (const depName of this.getEffectiveDeps(pkg)) {
                if (this.packageMap.has(depName)) {
                    let dependents = this.reverseDepsMap.get(depName);
                    if (!dependents) {
                        dependents = [];
                        this.reverseDepsMap.set(depName, dependents);
                    }
                    dependents.push(pkg);
                }
            }
        }
    }

    /**
     * In tree mode, returns true if `pkgName` is the filtered package or has
     * the filtered package as a descendant (i.e. can lead to the filtered
     * package via the reverse-dependency chain).
     */
    private packageLeadsToFiltered(pkgName: string, visited: Set<string>): boolean {
        if (pkgName === this.filteredPackageName) {
            return true;
        }
        if (visited.has(pkgName)) {
            return false;
        }
        visited.add(pkgName);
        const dependents = this.reverseDepsMap.get(pkgName) ?? [];
        for (const dep of dependents) {
            if (this.packageLeadsToFiltered(dep.name, visited)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Find (or build) a PackageTreeItem for the given package name.
     *
     * In flat mode every package is a root item, so a simple root-level item
     * is returned.
     *
     * In tree mode the package may be nested.  The method walks up the package's
     * workspace deps to find a path from a tree root to the target package and
     * returns the leaf item with fully linked `parent` references so that
     * `TreeView.reveal()` can navigate the full path.
     */
    findItemForPackage(pkgName: string): PackageTreeItem | undefined {
        const pkg = this.packageMap.get(pkgName);
        if (!pkg) {
            return undefined;
        }

        if (this.viewMode === "flat") {
            const rootPkg = this.rootPackages.find((p) => p.name === pkgName);
            return rootPkg
                ? this.createTreeItem(rootPkg, false, undefined)
                : undefined;
        }

        // Tree mode: build item chain from a root ancestor down to the target
        const chain = this.buildPathToRoot(pkgName, new Set());
        if (!chain) {
            return undefined;
        }

        let parentItem: PackageTreeItem | undefined = undefined;
        let targetItem: PackageTreeItem | undefined = undefined;
        for (const chainPkg of chain) {
            const item = this.createTreeItem(
                chainPkg,
                parentItem !== undefined,
                parentItem,
            );
            parentItem = item;
            if (chainPkg.name === pkgName) {
                targetItem = item;
            }
        }
        return targetItem;
    }

    /**
     * Recursively build the path [root, …, target] from a tree-mode root to
     * the package identified by `pkgName`.
     *
     * The parent is chosen as the alphabetically first workspace dep that is
     * itself a workspace package (consistent with the sorted display order).
     *
     * Returns `[pkg]` if the package is already a root (no workspace deps).
     * Returns `undefined` if `pkgName` is not in the package map.
     * The `visited` set guards against cycles in malformed workspaces.
     */
    private buildPathToRoot(
        pkgName: string,
        visited: Set<string>,
    ): PackageInfo[] | undefined {
        const pkg = this.packageMap.get(pkgName);
        if (!pkg) {
            return undefined;
        }

        // No workspace deps → this is a tree-mode root
        if (this.getEffectiveDeps(pkg).length === 0) {
            return [pkg];
        }

        // Find the alphabetically first dep that exists in the package map
        const sortedDeps = [...this.getEffectiveDeps(pkg)]
            .filter((d) => this.packageMap.has(d))
            .sort((a, b) => a.localeCompare(b));

        if (sortedDeps.length === 0) {
            // No known workspace deps → treat as root
            return [pkg];
        }

        const parentName = sortedDeps[0];
        if (visited.has(parentName)) {
            // Cycle detected – treat current node as root to avoid infinite loop
            return [pkg];
        }

        visited.add(parentName);
        const parentPath = this.buildPathToRoot(parentName, visited);
        if (!parentPath) {
            return [pkg];
        }
        return [...parentPath, pkg];
    }

    /**
     * Main loading logic:
     * 1. Read root package.json → workspaces
     * 2. Expand glob patterns to find package directories
     * 3. Parse each package.json
     * 4. Build packageMap and rootPackages
     * 5. Build reverseDepsMap (who depends on each package)
     */
    private async loadPackages(): Promise<void> {
        this.packageMap.clear();
        this.rootPackages = [];
        this.reverseDepsMap.clear();

        if (!this.workspaceRoot) {
            this.log("No workspace root found");
            return;
        }

        // Step 1: read root package.json
        const rootPkgJsonPath = path.join(this.workspaceRoot, "package.json");
        let workspaceGlobs: string[] = [];

        try {
            const content = await fs.promises.readFile(rootPkgJsonPath, "utf-8");
            const rootPkg = JSON.parse(content) as {
                workspaces?: string[] | { packages?: string[] };
            };

            if (Array.isArray(rootPkg.workspaces)) {
                workspaceGlobs = rootPkg.workspaces;
            } else if (
                rootPkg.workspaces &&
                Array.isArray(rootPkg.workspaces.packages)
            ) {
                workspaceGlobs = rootPkg.workspaces.packages;
            }
        } catch {
            this.log(`Could not read root package.json at ${rootPkgJsonPath}`);
            return;
        }

        if (workspaceGlobs.length === 0) {
            this.log("No workspaces entry found in root package.json");
            return;
        }

        this.log(`Found workspace globs: ${workspaceGlobs.join(", ")}`);

        // Step 2: resolve workspace paths
        const packageDirs = await this.resolveWorkspaceGlobs(workspaceGlobs);
        this.log(`Resolved ${packageDirs.length} package directories`);

        // Step 3: parse each package.json
        for (const dir of packageDirs) {
            const info = await this.parsePackageJson(dir);
            if (info) {
                this.packageMap.set(info.name, info);
            }
        }

        // Step 4: all resolved packages are root packages
        this.rootPackages = packageDirs
            .map((dir) => {
                // find package by path
                for (const pkg of this.packageMap.values()) {
                    if (pkg.packagePath === dir) {
                        return pkg;
                    }
                }
                return undefined;
            })
            .filter((p): p is PackageInfo => p !== undefined);

        // Step 5: build reverse dependency map
        this.rebuildReverseDepsMap();

        this.log(
            `Loaded ${this.packageMap.size} packages, ${this.rootPackages.length} root packages`,
        );
    }

    /**
     * Expand workspace glob patterns to actual directories containing package.json.
     * Supports patterns like "packages/*", "apps/my-app", etc.
     */
    private async resolveWorkspaceGlobs(globs: string[]): Promise<string[]> {
        const dirs: string[] = [];
        const seen = new Set<string>();

        for (const glob of globs) {
            // Use VS Code's findFiles to resolve glob patterns relative to workspace
            const pattern = new vscode.RelativePattern(
                this.workspaceRoot,
                glob.endsWith("package.json") ? glob : `${glob}/package.json`,
            );

            const files = await vscode.workspace.findFiles(
                pattern,
                "**/node_modules/**",
            );

            for (const file of files) {
                const dir = path.dirname(file.fsPath);
                if (!seen.has(dir)) {
                    seen.add(dir);
                    dirs.push(dir);
                }
            }
        }

        return dirs;
    }

    /**
     * Parse a package.json file and return a PackageInfo object.
     * Collects `workspace:*` entries from `dependencies` and `devDependencies`
     * separately so that the tree can be filtered by dependency type.
     */
    private async parsePackageJson(
        packageDir: string,
    ): Promise<PackageInfo | undefined> {
        const pkgJsonPath = path.join(packageDir, "package.json");

        try {
            const content = await fs.promises.readFile(pkgJsonPath, "utf-8");
            const pkg = JSON.parse(content) as {
                name?: string;
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };

            if (!pkg.name) {
                this.log(`No name field in ${pkgJsonPath}`);
                return undefined;
            }

            const workspaceRegularDeps: string[] = [];
            for (const [depName, version] of Object.entries(pkg.dependencies ?? {})) {
                if (version === "workspace:*") {
                    workspaceRegularDeps.push(depName);
                }
            }

            const workspaceDevDeps: string[] = [];
            for (const [depName, version] of Object.entries(pkg.devDependencies ?? {})) {
                if (version === "workspace:*") {
                    workspaceDevDeps.push(depName);
                }
            }

            return {
                name: pkg.name,
                packagePath: packageDir,
                workspaceRegularDeps,
                workspaceDevDeps,
            };
        } catch {
            this.log(`Could not parse package.json at ${pkgJsonPath}`);
            return undefined;
        }
    }
}
