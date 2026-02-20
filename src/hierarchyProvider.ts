import * as vscode from "vscode";
import { NodeClass, PropertyInfo, HierarchyChain, NodeRevision } from "./types";
import { XtremNodeParser } from "./nodeParser";

/**
 * Global registry to store tree item contexts and avoid circular references
 */
export const treeItemContextRegistry = new Map<
    string,
    {
        nodeClass: NodeClass;
        hierarchy: HierarchyChain;
    }
>();

/**
 * Tree item representing a hierarchy level
 */
export class HierarchyTreeItem extends vscode.TreeItem {
    public treeItemId: string = "";

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public data: {
            type: "root" | "node" | "property" | "revision" | "package";
            nodeClass?: NodeClass;
            property?: PropertyInfo;
            hierarchy?: HierarchyChain;
            packageName?: string;
            packageNodes?: NodeClass[];
            packageHierarchy?: Map<string, string[]>;
            nodesByPackage?: Map<string, NodeClass[]>;
        },
    ) {
        super(label, collapsibleState);
        this.setupUI();
    }

    private setupUI(): void {
        switch (this.data.type) {
            case "package":
                this.iconPath = new vscode.ThemeIcon("package");
                this.contextValue = "packageItem";
                break;
            case "node":
                this.iconPath = new vscode.ThemeIcon("symbol-class");
                // Use nodeItemWithHierarchy if this node has hierarchy info for the property detail action
                this.contextValue = this.data.hierarchy
                    ? "nodeItemWithHierarchy"
                    : "nodeItem";
                break;
            case "property":
                this.iconPath = new vscode.ThemeIcon("symbol-property");
                this.contextValue = "propertyItem";
                break;
            case "revision":
                this.iconPath = new vscode.ThemeIcon("symbol-field");
                // Use revisionItemWithHierarchy if this revision has hierarchy info for the property detail action
                this.contextValue = this.data.hierarchy
                    ? "revisionItemWithHierarchy"
                    : "revisionItem";
                break;
        }
    }
}

/**
 * Tree data provider for the hierarchy view
 */
export class HierarchyTreeDataProvider implements vscode.TreeDataProvider<HierarchyTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<
        HierarchyTreeItem | undefined | null | void
    > = new vscode.EventEmitter<HierarchyTreeItem | undefined | null | void>();

    onDidChangeTreeData?: vscode.Event<
        HierarchyTreeItem | undefined | null | void
    > = this._onDidChangeTreeData.event;

    private currentHierarchy: HierarchyChain | null = null;
    private parser: XtremNodeParser;
    private isEmpty = true;
    private showOnlyWithOverrides = false;
    private currentDirection: "upstream" | "downstream" = "upstream";
    private currentNodeName: string | null = null;
    private currentPropertyName: string | null = null;

    constructor(parser: XtremNodeParser) {
        this.parser = parser;
    }

    /**
     * Toggle the filter to show only nodes with overrides
     */
    toggleShowOnlyWithOverrides(): boolean {
        this.showOnlyWithOverrides = !this.showOnlyWithOverrides;
        this.refresh();
        return this.showOnlyWithOverrides;
    }

    /**
     * Get the current filter state
     */
    getShowOnlyWithOverrides(): boolean {
        return this.showOnlyWithOverrides;
    }

    /**
     * Toggle the search direction between upstream and downstream
     */
    async toggleSearchDirection(): Promise<"upstream" | "downstream" | null> {
        if (!this.currentNodeName || !this.currentPropertyName) {
            return null;
        }

        // Toggle direction
        this.currentDirection =
            this.currentDirection === "upstream" ? "downstream" : "upstream";

        // Re-run the search with the new direction
        const hierarchy = await this.parser.searchPropertyHierarchy(
            this.currentNodeName,
            this.currentPropertyName,
            this.currentDirection,
        );

        if (hierarchy) {
            this.setHierarchy(hierarchy);
        }

        return this.currentDirection;
    }

    /**
     * Get the current search direction
     */
    getCurrentDirection(): "upstream" | "downstream" {
        return this.currentDirection;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HierarchyTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(
        element?: HierarchyTreeItem,
    ): Promise<HierarchyTreeItem[]> {
        if (this.isEmpty && !element) {
            // Show empty state
            const emptyItem = new HierarchyTreeItem(
                "Search for a node property...",
                vscode.TreeItemCollapsibleState.None,
                { type: "root" },
            );
            emptyItem.description =
                "Use the search button above to get started";
            return [emptyItem];
        }

        if (!element) {
            // Root level - show the initial hierarchy if available
            if (this.currentHierarchy) {
                return this.buildHierarchyView(this.currentHierarchy);
            }
            return [];
        }

        // Build children based on the element type
        switch (element.data.type) {
            case "root":
                return [];
            case "package":
                if (
                    element.data.packageNodes &&
                    element.data.hierarchy &&
                    element.data.packageHierarchy &&
                    element.data.nodesByPackage
                ) {
                    return this.getPackageChildren(
                        element.data.packageName || "",
                        element.data.packageNodes,
                        element.data.hierarchy,
                        element.data.packageHierarchy,
                        element.data.nodesByPackage,
                    );
                }
                break;
            case "node":
                if (element.data.nodeClass) {
                    return this.getNodeChildren(element.data.nodeClass);
                }
                break;
            case "property":
                if (element.data.hierarchy) {
                    return this.getPropertyChildren(element.data.hierarchy);
                }
                break;
        }

        return [];
    }

    /**
     * Build the hierarchy view from search results
     */
    private buildHierarchyView(hierarchy: HierarchyChain): HierarchyTreeItem[] {
        const items: HierarchyTreeItem[] = [];

        // Show the property info at the top
        const propLabel = `Property: ${hierarchy.property.name}`;
        const propItem = new HierarchyTreeItem(
            propLabel,
            vscode.TreeItemCollapsibleState.Expanded,
            {
                type: "property",
                property: hierarchy.property,
                hierarchy: hierarchy,
            },
        );
        propItem.description = `${hierarchy.property.decoratorType}`;
        propItem.tooltip = `Declared in: ${hierarchy.property.declaredIn}`;
        items.push(propItem);

        return items;
    }

    /**
     * Get children for a node item
     */
    private getNodeChildren(nodeClass: NodeClass): HierarchyTreeItem[] {
        const items: HierarchyTreeItem[] = [];

        if (nodeClass.extends) {
            const parentItem = new HierarchyTreeItem(
                `extends: ${nodeClass.extends}`,
                vscode.TreeItemCollapsibleState.Collapsed,
                {
                    type: "node",
                    nodeClass: this.parser.getNode(nodeClass.extends),
                },
            );
            parentItem.iconPath = new vscode.ThemeIcon("symbol-interface");
            items.push(parentItem);
        }

        return items;
    }

    /**
     * Count visible children for a package (includes child packages and filtered nodes)
     */
    private countVisibleChildrenForPackage(
        pkgName: string,
        nodesByPackage: Map<string, NodeClass[]>,
        packageHierarchy: Map<string, string[]>,
        revisionsByNode: Map<string, NodeRevision[]>,
    ): number {
        let count = 0;

        // Count visible nodes in this package
        const nodesInPackage = nodesByPackage.get(pkgName) || [];
        for (const nodeClass of nodesInPackage) {
            // If filter is enabled, only count nodes with overrides
            if (this.showOnlyWithOverrides) {
                const revisions = revisionsByNode.get(nodeClass.name) || [];
                if (revisions.length > 0) {
                    count++;
                }
            } else {
                count++;
            }
        }

        // Count visible child packages
        const childPackages = packageHierarchy.get(pkgName) || [];
        for (const childPkg of childPackages) {
            count += this.countVisibleChildrenForPackage(
                childPkg,
                nodesByPackage,
                packageHierarchy,
                revisionsByNode,
            );
        }

        return count;
    }

    /**
     * Get children for a property item showing revisions grouped by package
     */
    private getPropertyChildren(
        hierarchy: HierarchyChain,
    ): HierarchyTreeItem[] {
        const items: HierarchyTreeItem[] = [];

        // Group nodes by package
        const nodesByPackage = new Map<string, typeof hierarchy.chain>();
        const packages = new Set<string>();
        for (const nodeClass of hierarchy.chain) {
            const pkg = nodeClass.packageName || "unknown";
            packages.add(pkg);
            if (!nodesByPackage.has(pkg)) {
                nodesByPackage.set(pkg, []);
            }
            nodesByPackage.get(pkg)!.push(nodeClass);
        }

        // Build package hierarchy based on dependencies
        const packageHierarchy = this.parser.buildPackageHierarchy(packages);

        // Group revisions by node for visibility checking
        const revisionsByNode = new Map<string, NodeRevision[]>();
        for (const revision of hierarchy.revisions) {
            if (!revisionsByNode.has(revision.className)) {
                revisionsByNode.set(revision.className, []);
            }
            revisionsByNode.get(revision.className)!.push(revision);
        }

        // Helper function to create a package tree item
        const buildPackageTree = (pkgName: string): HierarchyTreeItem => {
            const nodes = nodesByPackage.get(pkgName) || [];
            const children = packageHierarchy.get(pkgName) || [];

            // Create package item with children flag
            const packageItem = new HierarchyTreeItem(
                pkgName,
                children.length > 0 || nodes.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                {
                    type: "package",
                    packageName: pkgName,
                    packageNodes: nodes,
                    hierarchy: hierarchy,
                    packageHierarchy: packageHierarchy,
                    nodesByPackage: nodesByPackage,
                },
            );
            packageItem.description = `${nodes.length} class${nodes.length > 1 ? "es" : ""}`;

            return packageItem;
        };

        // Find root packages (those without parents in the hierarchy)
        const rootPackages: string[] = [];
        for (const [pkg] of packageHierarchy) {
            // A package is a root if no other package has it as a child
            let isRoot = true;
            for (const [, pkgChildren] of packageHierarchy) {
                if (pkgChildren.includes(pkg)) {
                    isRoot = false;
                    break;
                }
            }
            if (isRoot) {
                rootPackages.push(pkg);
            }
        }

        // Build tree from roots
        for (const rootPkg of rootPackages) {
            // If filter is active, only add package if it has visible children
            if (
                !this.showOnlyWithOverrides ||
                this.countVisibleChildrenForPackage(
                    rootPkg,
                    nodesByPackage,
                    packageHierarchy,
                    revisionsByNode,
                ) > 0
            ) {
                items.push(buildPackageTree(rootPkg));
            }
        }

        return items;
    }

    /**
     * Get children for a package item showing child packages and classes
     */
    private getPackageChildren(
        packageName: string,
        nodes: NodeClass[],
        hierarchy: HierarchyChain,
        packageHierarchy: Map<string, string[]>,
        nodesByPackage: Map<string, NodeClass[]>,
    ): HierarchyTreeItem[] {
        const items: HierarchyTreeItem[] = [];

        // Group revisions by node
        const revisionsByNode = new Map<string, NodeRevision[]>();
        for (const revision of hierarchy.revisions) {
            if (!revisionsByNode.has(revision.className)) {
                revisionsByNode.set(revision.className, []);
            }
            revisionsByNode.get(revision.className)!.push(revision);
        }

        // Add child packages first
        const childPackages = packageHierarchy.get(packageName) || [];
        for (const childPkg of childPackages) {
            // If filter is active, only add child package if it has visible children
            if (
                this.showOnlyWithOverrides &&
                this.countVisibleChildrenForPackage(
                    childPkg,
                    nodesByPackage,
                    packageHierarchy,
                    revisionsByNode,
                ) === 0
            ) {
                continue;
            }

            const childNodes = nodesByPackage.get(childPkg) || [];
            const childItem = new HierarchyTreeItem(
                childPkg,
                packageHierarchy.has(childPkg) &&
                    (packageHierarchy.get(childPkg) || []).length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.Collapsed,
                {
                    type: "package",
                    packageName: childPkg,
                    packageNodes: childNodes,
                    hierarchy: hierarchy,
                    packageHierarchy: packageHierarchy,
                    nodesByPackage: nodesByPackage,
                },
            );
            childItem.description = `${childNodes.length} class${childNodes.length > 1 ? "es" : ""}`;
            items.push(childItem);
        }

        // Create items for each class in this package
        for (const nodeClass of nodes) {
            const revisions = revisionsByNode.get(nodeClass.name) || [];

            // Filter: skip nodes without overrides if filter is enabled
            if (this.showOnlyWithOverrides && revisions.length === 0) {
                continue;
            }

            const revisionLabel =
                revisions.length > 0
                    ? `${nodeClass.name} (revised)`
                    : nodeClass.name;

            const chainItem = new HierarchyTreeItem(
                revisionLabel,
                revisions.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                {
                    type: "node",
                    nodeClass: nodeClass,
                    hierarchy: hierarchy,
                },
            );

            // Create a unique ID for this tree item and store its context
            const itemId = `${nodeClass.name}_${hierarchy.property.name}_${Date.now()}_${Math.random()}`;
            chainItem.treeItemId = itemId;
            treeItemContextRegistry.set(itemId, {
                nodeClass: nodeClass,
                hierarchy: hierarchy,
            });

            chainItem.description = `${nodeClass.type}`;
            chainItem.tooltip = nodeClass.sourcePath;

            // Set command to open the source file when clicking on the node
            chainItem.command = {
                title: "Open File",
                command: "vscode.open",
                arguments: [
                    vscode.Uri.file(nodeClass.sourcePath),
                    {
                        selection: new vscode.Range(
                            nodeClass.lineNumber - 1,
                            0,
                            nodeClass.lineNumber - 1,
                            0,
                        ),
                    },
                ],
            };

            items.push(chainItem);

            // Add revision details if any
            if (revisions.length > 0) {
                for (const revision of revisions) {
                    const revisionItem = new HierarchyTreeItem(
                        revision.decoratorType,
                        vscode.TreeItemCollapsibleState.None,
                        {
                            type: "revision",
                            nodeClass: nodeClass,
                            hierarchy: hierarchy,
                        },
                    );

                    // Create a unique ID for this revision and store its context
                    const revisionId = `${nodeClass.name}_${hierarchy.property.name}_revision_${Date.now()}_${Math.random()}`;
                    revisionItem.treeItemId = revisionId;
                    treeItemContextRegistry.set(revisionId, {
                        nodeClass: nodeClass,
                        hierarchy: hierarchy,
                    });

                    revisionItem.description = `line ${revision.lineNumber}`;
                    revisionItem.tooltip = `${revision.decoratorType} - Params: ${JSON.stringify(revision.decoratorParams)}`;
                    revisionItem.command = {
                        title: "Open File",
                        command: "vscode.open",
                        arguments: [
                            vscode.Uri.file(revision.sourcePath),
                            {
                                selection: new vscode.Range(
                                    revision.lineNumber - 1,
                                    0,
                                    revision.lineNumber - 1,
                                    0,
                                ),
                            },
                        ],
                    };
                    items.push(revisionItem);
                }
            }
        }

        return items;
    }

    /**
     * Format decorator parameters for display
     */
    private formatDecoratorParams(params: Record<string, unknown>): string {
        const entries = Object.entries(params)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(", ");
        return entries || "@decorator";
    }

    /**
     * Update the view with new hierarchy results
     */
    setHierarchy(
        hierarchy: HierarchyChain | null,
        nodeName?: string,
        propertyName?: string,
        direction?: "upstream" | "downstream",
    ): void {
        this.currentHierarchy = hierarchy;
        this.isEmpty = hierarchy === null;

        // Store search parameters for direction toggle
        if (nodeName && propertyName && direction) {
            this.currentNodeName = nodeName;
            this.currentPropertyName = propertyName;
            this.currentDirection = direction;
        } else if (hierarchy === null) {
            this.currentNodeName = null;
            this.currentPropertyName = null;
        }

        this.refresh();
    }

    /**
     * Get the current hierarchy
     */
    getHierarchy(): HierarchyChain | null {
        return this.currentHierarchy;
    }
}
