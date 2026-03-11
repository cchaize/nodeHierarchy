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
            type: "root" | "node" | "property" | "revision";
            nodeClass?: NodeClass;
            property?: PropertyInfo;
            hierarchy?: HierarchyChain;
        },
    ) {
        super(label, collapsibleState);
        this.setupUI();
    }

    private setupUI(): void {
        switch (this.data.type) {
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
    private outputChannel: vscode.OutputChannel | undefined;

    constructor(parser: XtremNodeParser, outputChannel?: vscode.OutputChannel) {
        this.parser = parser;
        this.outputChannel = outputChannel;
    }

    private log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[HierarchyProvider] ${message}`);
        }
    }

    private formatNodeLabel(nodeClass: NodeClass): string {
        return nodeClass.name;
    }

    private getNodeHierarchyIcon(
        nodeClass: NodeClass,
        isDefinedInNode: boolean,
    ): vscode.ThemeIcon {
        const iconId =
            nodeClass.type === "subNode" ? "symbol-interface" : "symbol-class";

        return isDefinedInNode
            ? new vscode.ThemeIcon(
                  iconId,
                  new vscode.ThemeColor("editorError.foreground"),
              )
            : new vscode.ThemeIcon(
                  iconId,
                  new vscode.ThemeColor("editorInfo.foreground"),
              );
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
        if (this.currentHierarchy) {
            return this.getHierarchyNodeChildren(
                nodeClass,
                this.currentHierarchy,
            );
        }

        const items: HierarchyTreeItem[] = [];

        if (nodeClass.extends) {
            const parentNode = this.parser.getNode(nodeClass.extends);
            const parentItem = new HierarchyTreeItem(
                `extends: ${parentNode ? this.formatNodeLabel(parentNode) : nodeClass.extends}`,
                vscode.TreeItemCollapsibleState.Collapsed,
                {
                    type: "node",
                    nodeClass: parentNode,
                },
            );
            parentItem.iconPath = new vscode.ThemeIcon("symbol-interface");
            items.push(parentItem);
        }

        return items;
    }

    private isPropertyDefinedInNode(
        nodeClass: NodeClass,
        revisionsByNode: Map<string, NodeRevision[]>,
    ): boolean {
        return (revisionsByNode.get(nodeClass.name) || []).length > 0;
    }

    private getVisibleHierarchyNodes(
        hierarchy: HierarchyChain,
        revisionsByNode: Map<string, NodeRevision[]>,
    ): NodeClass[] {
        return hierarchy.chain.filter((nodeClass) => {
            if (!this.showOnlyWithOverrides) {
                return true;
            }

            return this.isPropertyDefinedInNode(nodeClass, revisionsByNode);
        });
    }

    private getParentNodeInHierarchy(
        nodeClass: NodeClass,
        visibleNodes: Map<string, NodeClass>,
    ): NodeClass | undefined {
        let parentName = nodeClass.extends;

        while (parentName) {
            const parentNode = visibleNodes.get(parentName);
            if (parentNode) {
                return parentNode;
            }

            parentName = this.parser.getNode(parentName)?.extends;
        }

        return undefined;
    }

    private getHierarchyRoots(
        visibleHierarchyNodes: NodeClass[],
        visibleNodesByName: Map<string, NodeClass>,
    ): NodeClass[] {
        if (this.currentDirection === "upstream") {
            return visibleHierarchyNodes.length > 0
                ? [visibleHierarchyNodes[0]]
                : [];
        }

        return visibleHierarchyNodes.filter(
            (nodeClass) =>
                !this.getParentNodeInHierarchy(nodeClass, visibleNodesByName),
        );
    }

    private getNodeOpenTarget(
        nodeClass: NodeClass,
        hierarchy: HierarchyChain,
    ): { sourcePath: string; lineNumber: number } {
        const propertyInNode = nodeClass.properties.get(
            hierarchy.property.name,
        );

        if (propertyInNode) {
            return {
                sourcePath: propertyInNode.sourcePath,
                lineNumber: propertyInNode.lineNumber,
            };
        }

        return {
            sourcePath: nodeClass.sourcePath,
            lineNumber: nodeClass.lineNumber,
        };
    }

    private createHierarchyNodeItem(
        nodeClass: NodeClass,
        hierarchy: HierarchyChain,
        revisionsByNode: Map<string, NodeRevision[]>,
        visibleNodesByName: Map<string, NodeClass>,
    ): HierarchyTreeItem {
        const isOverride = this.isPropertyDefinedInNode(
            nodeClass,
            revisionsByNode,
        );
        const hasChildren =
            this.getHierarchyChildNodes(
                nodeClass,
                hierarchy,
                revisionsByNode,
                visibleNodesByName,
            ).length > 0;

        const nodeItem = new HierarchyTreeItem(
            this.formatNodeLabel(nodeClass),
            hasChildren
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
            {
                type: "node",
                nodeClass: nodeClass,
                hierarchy: hierarchy,
            },
        );

        const itemId = `${nodeClass.name}_${hierarchy.property.name}_${Date.now()}_${Math.random()}`;
        nodeItem.treeItemId = itemId;
        treeItemContextRegistry.set(itemId, {
            nodeClass: nodeClass,
            hierarchy: hierarchy,
        });

        nodeItem.iconPath = this.getNodeHierarchyIcon(nodeClass, isOverride);
        nodeItem.label = this.formatNodeLabel(nodeClass);
        nodeItem.description = nodeClass.packageName
            ? `${nodeClass.packageName} • ${nodeClass.type}`
            : nodeClass.type;

        const extension = this.parser.getNodeExtension(nodeClass.name);
        if (extension) {
            const iconColor = isOverride
                ? new vscode.ThemeColor("editorError.foreground")
                : new vscode.ThemeColor("editorInfo.foreground");
            nodeItem.iconPath = new vscode.ThemeIcon("warning", iconColor);
            const tooltip = new vscode.MarkdownString("", true);
            tooltip.supportHtml = true;
            tooltip.appendMarkdown(
                `**${this.formatNodeLabel(nodeClass)}**` +
                    (nodeClass.packageName
                        ? ` • ${nodeClass.packageName} • ${nodeClass.type}`
                        : ` • ${nodeClass.type}`) +
                    `\n\n<span style="color:orange;">⚠ An extension (**${extension.name}**) exists and may override this property</span>`,
            );
            nodeItem.tooltip = tooltip;
        } else {
            nodeItem.tooltip = nodeClass.packageName
                ? `${this.formatNodeLabel(nodeClass)} • ${nodeClass.packageName} • ${nodeClass.type}`
                : `${this.formatNodeLabel(nodeClass)} • ${nodeClass.type}`;
        }
        const openTarget = this.getNodeOpenTarget(nodeClass, hierarchy);
        nodeItem.command = {
            title: "Open File",
            command: "vscode.open",
            arguments: [
                vscode.Uri.file(openTarget.sourcePath),
                {
                    selection: new vscode.Range(
                        openTarget.lineNumber - 1,
                        0,
                        openTarget.lineNumber - 1,
                        0,
                    ),
                },
            ],
        };

        return nodeItem;
    }

    private getHierarchyChildNodes(
        nodeClass: NodeClass,
        hierarchy: HierarchyChain,
        revisionsByNode: Map<string, NodeRevision[]>,
        visibleNodesByName: Map<string, NodeClass>,
    ): NodeClass[] {
        const visibleHierarchyNodes = this.getVisibleHierarchyNodes(
            hierarchy,
            revisionsByNode,
        );

        if (this.currentDirection === "upstream") {
            const parentNode = this.getParentNodeInHierarchy(
                nodeClass,
                visibleNodesByName,
            );
            return parentNode ? [parentNode] : [];
        }

        return visibleHierarchyNodes.filter((candidateNode) => {
            if (candidateNode.name === nodeClass.name) {
                return false;
            }

            const parentNode = this.getParentNodeInHierarchy(
                candidateNode,
                visibleNodesByName,
            );
            return parentNode?.name === nodeClass.name;
        });
    }

    private getHierarchyNodeChildren(
        nodeClass: NodeClass,
        hierarchy: HierarchyChain,
    ): HierarchyTreeItem[] {
        const revisionsByNode = new Map<string, NodeRevision[]>();
        for (const revision of hierarchy.revisions) {
            if (!revisionsByNode.has(revision.className)) {
                revisionsByNode.set(revision.className, []);
            }
            revisionsByNode.get(revision.className)!.push(revision);
        }

        const visibleHierarchyNodes = this.getVisibleHierarchyNodes(
            hierarchy,
            revisionsByNode,
        );
        const visibleNodesByName = new Map(
            visibleHierarchyNodes.map((visibleNode) => [
                visibleNode.name,
                visibleNode,
            ]),
        );

        return this.getHierarchyChildNodes(
            nodeClass,
            hierarchy,
            revisionsByNode,
            visibleNodesByName,
        ).map((childNode) =>
            this.createHierarchyNodeItem(
                childNode,
                hierarchy,
                revisionsByNode,
                visibleNodesByName,
            ),
        );
    }

    private getPropertyChildren(
        hierarchy: HierarchyChain,
    ): HierarchyTreeItem[] {
        const revisionsByNode = new Map<string, NodeRevision[]>();
        for (const revision of hierarchy.revisions) {
            if (!revisionsByNode.has(revision.className)) {
                revisionsByNode.set(revision.className, []);
            }
            revisionsByNode.get(revision.className)!.push(revision);
        }
        const visibleHierarchyNodes = this.getVisibleHierarchyNodes(
            hierarchy,
            revisionsByNode,
        );
        const visibleNodesByName = new Map(
            visibleHierarchyNodes.map((visibleNode) => [
                visibleNode.name,
                visibleNode,
            ]),
        );

        return this.getHierarchyRoots(
            visibleHierarchyNodes,
            visibleNodesByName,
        ).map((rootNode) =>
            this.createHierarchyNodeItem(
                rootNode,
                hierarchy,
                revisionsByNode,
                visibleNodesByName,
            ),
        );
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
