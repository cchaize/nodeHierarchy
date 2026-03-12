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
    /** workspace:* dependencies (package names) */
    workspaceDeps: string[];
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
    ) {
        super(packageInfo.name, collapsibleState);
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
            const roots =
                this.viewMode === "tree"
                    ? this.computeTreeRoots()
                    : this.rootPackages;
            return roots.map((pkg) => this.createTreeItem(pkg, false));
        }

        if (this.viewMode === "tree") {
            // Tree mode children: packages that depend on this one (reverse deps)
            const dependents = this.reverseDepsMap.get(element.packageInfo.name) ?? [];
            return dependents.map((pkg) => this.createTreeItem(pkg, true));
        }

        // Flat mode children: workspace:* dependencies of this package
        const deps = element.packageInfo.workspaceDeps
            .map((depName) => this.packageMap.get(depName))
            .filter((p): p is PackageInfo => p !== undefined);

        return deps.map((pkg) => this.createTreeItem(pkg, true));
    }

    getParent(_element: PackageTreeItem): undefined {
        // Parent tracking is not needed – reveal() works by searching from root items.
        return undefined;
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
        return roots.map((pkg) => this.createTreeItem(pkg, false));
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
        return this.rootPackages.filter((pkg) => pkg.workspaceDeps.length === 0);
    }

    private createTreeItem(
        pkg: PackageInfo,
        isDependency: boolean,
    ): PackageTreeItem {
        const hasChildren =
            this.viewMode === "tree"
                ? (this.reverseDepsMap.get(pkg.name)?.length ?? 0) > 0
                : pkg.workspaceDeps.some((d) => this.packageMap.has(d));
        const collapsible = hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        return new PackageTreeItem(pkg, collapsible, isDependency);
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
        for (const pkg of this.packageMap.values()) {
            for (const depName of pkg.workspaceDeps) {
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
     * Only keeps `workspace:*` entries from dependencies (and devDependencies).
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

            // Collect workspace:* deps from both dependencies and devDependencies
            const workspaceDeps: string[] = [];
            const allDeps: Record<string, string> = {
                ...(pkg.dependencies ?? {}),
                ...(pkg.devDependencies ?? {}),
            };

            for (const [depName, version] of Object.entries(allDeps)) {
                if (version === "workspace:*") {
                    workspaceDeps.push(depName);
                }
            }

            return {
                name: pkg.name,
                packagePath: packageDir,
                workspaceDeps,
            };
        } catch {
            this.log(`Could not parse package.json at ${pkgJsonPath}`);
            return undefined;
        }
    }
}
