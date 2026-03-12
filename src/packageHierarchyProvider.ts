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
 *   "flat" – every workspace package appears at the root level (default)
 *   "tree" – only true root packages (those not depended on by any other
 *             workspace package) appear at the top; each package appears once
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

        // Children: workspace:* dependencies of this package
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
     * level: those that no other workspace package depends on (via workspace:*).
     */
    private computeTreeRoots(): PackageInfo[] {
        // Build the set of package names that are workspace:* deps of at least
        // one other workspace package.
        const depNames = new Set<string>();
        for (const pkg of this.packageMap.values()) {
            for (const dep of pkg.workspaceDeps) {
                depNames.add(dep);
            }
        }

        // Root packages in tree mode = all workspace packages NOT in depNames,
        // limited to the packages discovered from the workspaces globs.
        return this.rootPackages.filter((pkg) => !depNames.has(pkg.name));
    }

    private createTreeItem(
        pkg: PackageInfo,
        isDependency: boolean,
    ): PackageTreeItem {
        const hasWorkspaceDeps = pkg.workspaceDeps.some((d) =>
            this.packageMap.has(d),
        );
        const collapsible = hasWorkspaceDeps
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
     */
    private async loadPackages(): Promise<void> {
        this.packageMap.clear();
        this.rootPackages = [];

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
