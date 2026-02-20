import * as vscode from "vscode";
import { XtremNodeParser } from "./nodeParser";
import { HierarchyTreeDataProvider } from "./hierarchyProvider";

/**
 * Search input handler for the hierarchy search
 */
export class HierarchySearchInput {
    private parser: XtremNodeParser;
    private provider: HierarchyTreeDataProvider;

    constructor(parser: XtremNodeParser, provider: HierarchyTreeDataProvider) {
        this.parser = parser;
        this.provider = provider;
    }

    /**
     * Show search dialog
     */
    async showSearchDialog(
        direction: "upstream" | "downstream" = "upstream",
    ): Promise<void> {
        try {
            // Get all available nodes for autocomplete
            const nodes = this.parser.getNodes();
            const nodeNames = nodes.map((n) => n.name).sort();

            const backItem: vscode.QuickPickItem = {
                label: "$(arrow-left) Back",
                description: "Choose another node",
            };

            if (nodeNames.length === 0) {
                vscode.window.showErrorMessage(
                    "No Xtrem nodes found in workspace. Make sure to parse the workspace first.",
                );
                return;
            }

            while (true) {
                // Step 1: Select node
                const selectedNode = await vscode.window.showQuickPick(
                    nodeNames,
                    {
                        placeHolder: "Select a Xtrem node...",
                        matchOnDescription: true,
                    },
                );

                if (!selectedNode) {
                    return;
                }

                const nodeClass = this.parser.getNode(selectedNode);
                if (!nodeClass) {
                    return;
                }

                // Step 2: Select property (including inherited ones)
                const allProperties =
                    this.parser.getAllProperties(selectedNode);
                const propertyNames = Array.from(allProperties.keys()).sort();

                if (propertyNames.length === 0) {
                    vscode.window.showInformationMessage(
                        `No properties found in node ${selectedNode}`,
                    );
                    return;
                }

                const propertyItems: vscode.QuickPickItem[] = [
                    backItem,
                    ...propertyNames.map((name) => ({ label: name })),
                ];

                const selectedProperty = await vscode.window.showQuickPick(
                    propertyItems,
                    {
                        placeHolder: `Select a property from ${selectedNode}...`,
                        matchOnDescription: true,
                    },
                );

                if (!selectedProperty) {
                    return;
                }

                if (selectedProperty.label === backItem.label) {
                    continue;
                }

                // Perform the search
                await this.performSearch(
                    selectedNode,
                    selectedProperty.label,
                    direction,
                );
                return;
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            console.error("Search error:", error);
        }
    }

    /**
     * Perform the actual search
     */
    private async performSearch(
        nodeName: string,
        propertyName: string,
        direction: "upstream" | "downstream",
    ): Promise<void> {
        try {
            const hierarchy = await this.parser.searchPropertyHierarchy(
                nodeName,
                propertyName,
                direction,
            );

            if (!hierarchy) {
                vscode.window.showWarningMessage(
                    `Property "${propertyName}" not found in node "${nodeName}" or its ${direction} hierarchy.`,
                );
                this.provider.setHierarchy(null);
                return;
            }

            // Update the tree view with results
            this.provider.setHierarchy(
                hierarchy,
                nodeName,
                propertyName,
                direction,
            );

            // Update direction context for the toggle direction button
            await vscode.commands.executeCommand(
                "setContext",
                "xtremNodesHierarchy.currentDirection",
                direction,
            );

            // Show status
            const chainLength = hierarchy.chain.length;
            const revisionCount = hierarchy.revisions.length;

            vscode.window.showInformationMessage(
                `Found "${propertyName}" in ${chainLength} classes with ${revisionCount} revisions (${direction})`,
            );
        } catch (error) {
            vscode.window.showErrorMessage(
                `Search error: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            console.error("Search error:", error);
        }
    }

    /**
     * Show search input in quick pick with advanced options
     */
    async showAdvancedSearch(): Promise<void> {
        const backItem: vscode.QuickPickItem = {
            label: "$(arrow-left) Back",
            description: "Close search",
        };

        const direction = await vscode.window.showQuickPick(
            [
                backItem,
                {
                    label: "⬆️ Upstream Search",
                    description: "Find property in parent classes",
                    picked: true,
                },
                {
                    label: "⬇️ Downstream Search",
                    description: "Find property in child classes",
                },
            ],
            { placeHolder: "Select search direction..." },
        );

        if (!direction || direction.label === backItem.label) {
            return;
        }

        const searchDir = direction.label.includes("Upstream")
            ? "upstream"
            : "downstream";
        await this.showSearchDialog(searchDir);
    }
}
