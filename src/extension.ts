// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { XtremNodeParser } from "./nodeParser";
import {
    HierarchyTreeDataProvider,
    treeItemContextRegistry,
} from "./hierarchyProvider";
import { HierarchySearchInput } from "./searchInput";
import { PropertyDetailView } from "./propertyDetailView";
import { PackageHierarchyProvider, PackageTreeItem } from "./packageHierarchyProvider";

let parser: XtremNodeParser;
let provider: HierarchyTreeDataProvider;
let searchInput: HierarchySearchInput;
let propertyDetailView: PropertyDetailView;
let outputChannel: vscode.OutputChannel;
let packageProvider: PackageHierarchyProvider;
let packageTreeView: vscode.TreeView<PackageTreeItem>;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel("Xtrem Nodes Hierarchy");
    outputChannel.appendLine(
        'Extension "xtrem-nodes-hierarchy" is now active!',
    );

    // Initialize the parser and provider
    parser = new XtremNodeParser(outputChannel);
    provider = new HierarchyTreeDataProvider(parser, outputChannel);
    searchInput = new HierarchySearchInput(parser, provider);
    propertyDetailView = new PropertyDetailView(parser, outputChannel);

    // Initialize the packages hierarchy provider
    packageProvider = new PackageHierarchyProvider(outputChannel);

    context.subscriptions.push(outputChannel);

    // Register the tree view
    const treeView = vscode.window.createTreeView("nodesHierarchyView", {
        treeDataProvider: provider,
    });

    context.subscriptions.push(treeView);

    // Register the packages hierarchy tree view
    packageTreeView = vscode.window.createTreeView("packagesHierarchyView", {
        treeDataProvider: packageProvider,
        showCollapseAll: true,
    });

    context.subscriptions.push(packageTreeView);

    // Initialize the filter context
    await vscode.commands.executeCommand(
        "setContext",
        "xtremNodesHierarchy.filterActive",
        false,
    );

    // Initialize the direction context
    await vscode.commands.executeCommand(
        "setContext",
        "xtremNodesHierarchy.currentDirection",
        "upstream",
    );

    // Initialize the packages view mode context
    await vscode.commands.executeCommand(
        "setContext",
        "xtremPackages.viewMode",
        "flat",
    );

    // Register search command
    const searchCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.search",
        async () => {
            try {
                // Ensure workspace is parsed
                if (parser.getNodes().length === 0) {
                    vscode.window.showInformationMessage(
                        "Parsing workspace for Xtrem nodes...",
                    );
                    await parser.parseWorkspace();
                }

                // Show advanced search options
                await searchInput.showAdvancedSearch();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register upstream search command
    const upstreamCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.searchUpstream",
        async () => {
            try {
                if (parser.getNodes().length === 0) {
                    await parser.parseWorkspace();
                }
                await searchInput.showSearchDialog();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register downstream search command
    const downstreamCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.searchDownstream",
        async () => {
            try {
                if (parser.getNodes().length === 0) {
                    await parser.parseWorkspace();
                }
                await searchInput.showSearchDialog();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.refresh",
        async () => {
            try {
                parser.clearCache();
                vscode.window.showInformationMessage(
                    "Parsing workspace for Xtrem nodes...",
                );
                await parser.parseWorkspace();
                provider.setHierarchy(null);
                provider.refresh();
                vscode.window.showInformationMessage(
                    "Workspace parsed successfully",
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register toggle overrides filter command
    const toggleOverridesCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.toggleShowOnlyWithOverrides",
        async () => {
            const isEnabled = provider.toggleShowOnlyWithOverrides();
            const status = isEnabled
                ? "Showing only nodes with overrides"
                : "Showing all nodes";
            vscode.window.showInformationMessage(status);

            // Update context for icon change
            await vscode.commands.executeCommand(
                "setContext",
                "xtremNodesHierarchy.filterActive",
                isEnabled,
            );
        },
    );

    // Register toggle overrides filter command (active state - same behavior)
    const toggleOverridesActiveCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.toggleShowOnlyWithOverridesActive",
        async () => {
            const isEnabled = provider.toggleShowOnlyWithOverrides();
            const status = isEnabled
                ? "Showing only nodes with overrides"
                : "Showing all nodes";
            vscode.window.showInformationMessage(status);

            // Update context for icon change
            await vscode.commands.executeCommand(
                "setContext",
                "xtremNodesHierarchy.filterActive",
                isEnabled,
            );
        },
    );

    // Register search from editor command
    const searchFromEditorCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.searchFromEditor",
        async () => {
            try {
                // Ensure workspace is parsed
                if (parser.getNodes().length === 0) {
                    vscode.window.showInformationMessage(
                        "Parsing workspace for Xtrem nodes...",
                    );
                    await parser.parseWorkspace();
                }

                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage("No active editor");
                    return;
                }

                const document = editor.document;
                const position = editor.selection.active;
                const line = document.lineAt(position.line);
                const lineText = line.text;

                // Look for "readonly propertyName" pattern
                const readonlyMatch = lineText.match(
                    /readonly\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
                );
                if (!readonlyMatch) {
                    vscode.window.showErrorMessage(
                        "No property found on this line. Place cursor on a line with 'readonly propertyName'.",
                    );
                    return;
                }

                const propertyName = readonlyMatch[1];

                // Check if there's an @override decorator above
                let hasOverride = false;
                for (
                    let i = position.line - 1;
                    i >= Math.max(0, position.line - 10);
                    i--
                ) {
                    const prevLine = document.lineAt(i).text;
                    if (prevLine.includes("@override")) {
                        hasOverride = true;
                        break;
                    }
                    // Stop if we hit another property or class
                    if (
                        prevLine.match(/readonly\s+[a-zA-Z_$]/) ||
                        prevLine.match(/class\s+[a-zA-Z_$]/)
                    ) {
                        break;
                    }
                }

                // Find the node class name
                let className = "";
                for (let i = position.line; i >= 0; i--) {
                    const prevLine = document.lineAt(i).text;
                    const classMatch = prevLine.match(
                        /(?:export\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
                    );
                    if (classMatch) {
                        className = classMatch[1];
                        break;
                    }
                }

                if (!className) {
                    vscode.window.showErrorMessage("Could not find class name");
                    return;
                }

                // Determine direction based on override
                const direction = hasOverride ? "upstream" : "downstream";

                // Perform the search
                const result = await parser.searchPropertyHierarchy(
                    className,
                    propertyName,
                    direction,
                );

                if (result) {
                    provider.setHierarchy(
                        result,
                        className,
                        propertyName,
                        direction,
                    );

                    // Update direction context for the toggle direction button
                    await vscode.commands.executeCommand(
                        "setContext",
                        "xtremNodesHierarchy.currentDirection",
                        direction,
                    );
                } else {
                    vscode.window.showWarningMessage(
                        `Property "${propertyName}" not found in node "${className}".`,
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register toggle to downstream command
    const toggleToDownstreamCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.toggleToDownstream",
        async () => {
            try {
                const newDirection = await provider.toggleSearchDirection();

                if (newDirection === null) {
                    vscode.window.showInformationMessage(
                        "No active search. Please search for a property first.",
                    );
                } else {
                    // Update context to indicate current search direction
                    await vscode.commands.executeCommand(
                        "setContext",
                        "xtremNodesHierarchy.currentDirection",
                        newDirection,
                    );

                    vscode.window.showInformationMessage(
                        `Search direction: ⬇ Downstream`,
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error toggling direction: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register toggle to upstream command
    const toggleToUpstreamCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.toggleToUpstream",
        async () => {
            try {
                const newDirection = await provider.toggleSearchDirection();

                if (newDirection === null) {
                    vscode.window.showInformationMessage(
                        "No active search. Please search for a property first.",
                    );
                } else {
                    // Update context to indicate current search direction
                    await vscode.commands.executeCommand(
                        "setContext",
                        "xtremNodesHierarchy.currentDirection",
                        newDirection,
                    );

                    vscode.window.showInformationMessage(
                        `Search direction: ⬆ Upstream`,
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error toggling direction: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    // Register show property detail command
    const showPropertyDetailCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.showPropertyDetail",
        async (treeItem: any) => {
            try {
                outputChannel.appendLine(
                    "=== showPropertyDetail command called ===",
                );
                outputChannel.appendLine(`treeItem type: ${typeof treeItem}`);
                outputChannel.appendLine(
                    `treeItem has treeItemId: ${treeItem?.treeItemId ? "yes" : "no"}`,
                );

                // VS Code passes the TreeItem object, extract the treeItemId from it
                const itemId = treeItem?.treeItemId;
                if (!itemId) {
                    outputChannel.appendLine(
                        "ERROR: No treeItemId found in treeItem",
                    );
                    vscode.window.showErrorMessage(
                        "Invalid item - no ID found",
                    );
                    return;
                }

                outputChannel.appendLine(`itemId: ${itemId}`);

                // Get context from registry
                const context = treeItemContextRegistry.get(itemId);
                if (!context) {
                    outputChannel.appendLine(
                        `ERROR: No context found for itemId: ${itemId}`,
                    );
                    vscode.window.showErrorMessage(
                        "Context not found for this item",
                    );
                    return;
                }

                const nodeClass = context.nodeClass;
                const hierarchy = context.hierarchy;

                outputChannel.appendLine(`nodeClass: ${nodeClass?.name}`);
                outputChannel.appendLine(
                    `hierarchy: ${hierarchy ? "present" : "missing"}`,
                );

                if (!nodeClass || !hierarchy) {
                    outputChannel.appendLine(
                        "ERROR: Missing node or hierarchy data",
                    );
                    vscode.window.showErrorMessage(
                        "Missing node or hierarchy data",
                    );
                    return;
                }

                const propertyName = hierarchy.property.name;
                outputChannel.appendLine(`propertyName: ${propertyName}`);
                outputChannel.appendLine(
                    `Calling propertyDetailView.showPropertyDetail...`,
                );

                // Show the property detail
                await propertyDetailView.showPropertyDetail(
                    nodeClass,
                    propertyName,
                    hierarchy,
                );

                outputChannel.appendLine("Property detail shown successfully");
            } catch (error) {
                outputChannel.appendLine(`ERROR: ${error}`);
                vscode.window.showErrorMessage(
                    `Error showing property detail: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );

    context.subscriptions.push(searchCommand);
    context.subscriptions.push(upstreamCommand);
    context.subscriptions.push(downstreamCommand);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(toggleOverridesCommand);
    context.subscriptions.push(toggleOverridesActiveCommand);
    context.subscriptions.push(searchFromEditorCommand);
    context.subscriptions.push(toggleToDownstreamCommand);
    context.subscriptions.push(toggleToUpstreamCommand);
    context.subscriptions.push(showPropertyDetailCommand);

    // Register refresh packages command
    const refreshPackagesCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.refreshPackages",
        async () => {
            try {
                outputChannel.appendLine("Refreshing packages hierarchy...");
                await packageProvider.refresh();
                outputChannel.appendLine("Packages hierarchy refreshed");
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Refresh packages failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        },
    );
    context.subscriptions.push(refreshPackagesCommand);

    // Helper to handle both toggle commands (they share the same logic)
    const togglePackageViewMode = async (): Promise<void> => {
        const newMode = packageProvider.toggleViewMode();
        await vscode.commands.executeCommand(
            "setContext",
            "xtremPackages.viewMode",
            newMode,
        );
        const label = newMode === "tree" ? "Tree View" : "Flat View";
        vscode.window.showInformationMessage(
            `Packages hierarchy: switched to ${label}`,
        );
    };

    const togglePackageViewToTreeCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.togglePackageViewToTree",
        togglePackageViewMode,
    );
    context.subscriptions.push(togglePackageViewToTreeCommand);

    const togglePackageViewToFlatCommand = vscode.commands.registerCommand(
        "xtrem-nodes-hierarchy.togglePackageViewToFlat",
        togglePackageViewMode,
    );
    context.subscriptions.push(togglePackageViewToFlatCommand);

    // Sync packages tree view focus with the active editor
    const syncPackagesFocus = async (
        editor: vscode.TextEditor | undefined,
    ): Promise<void> => {
        if (!editor) {
            return;
        }
        const filePath = editor.document.uri.fsPath;
        const pkg = packageProvider.findPackageForFile(filePath);
        if (!pkg) {
            return;
        }
        // Find the matching root-level tree item and reveal it
        const rootItems = packageProvider.getRootItems();
        const item = rootItems.find((i) => i.packageInfo.name === pkg.name);
        if (item) {
            try {
                await packageTreeView.reveal(item, {
                    select: true,
                    focus: false,
                    expand: false,
                });
            } catch (err) {
                outputChannel.appendLine(
                    `[PackageHierarchy] Could not reveal package "${pkg.name}": ${err}`,
                );
            }
        }
    };

    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(
        syncPackagesFocus,
    );
    context.subscriptions.push(editorChangeListener);

    // Parse the workspace on activation
    try {
        outputChannel.appendLine("Parsing workspace for Xtrem nodes...");
        await parser.parseWorkspace();
        outputChannel.appendLine(
            `Found ${parser.getNodes().length} Xtrem nodes`,
        );
    } catch (error) {
        outputChannel.appendLine(`Error parsing workspace: ${error}`);
    }

    // Load packages hierarchy on activation
    try {
        outputChannel.appendLine("Loading packages hierarchy...");
        await packageProvider.refresh();
    } catch (error) {
        outputChannel.appendLine(`Error loading packages hierarchy: ${error}`);
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}
