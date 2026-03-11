import * as vscode from "vscode";
import { XtremNodeParser } from "./nodeParser";
import { HierarchyTreeDataProvider } from "./hierarchyProvider";

interface SearchableQuickPickItem extends vscode.QuickPickItem {
    searchText: string;
    isPinned?: boolean;
}

function normalizeSearchText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export function splitIdentifierWords(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/[^a-zA-Z0-9]+/)
        .map((part) => normalizeSearchText(part))
        .filter(Boolean);
}

function isSubsequence(query: string, target: string): boolean {
    let queryIndex = 0;

    for (const character of target) {
        if (character === query[queryIndex]) {
            queryIndex += 1;
        }

        if (queryIndex === query.length) {
            return true;
        }
    }

    return query.length === 0;
}

export function getLooseMatchScore(
    candidate: string,
    query: string,
): number | null {
    const queryWords = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) {
        return 0;
    }

    const candidateWords = splitIdentifierWords(candidate);
    const compactCandidate = candidateWords.join("");
    const compactQuery = queryWords.join("");
    const initials = candidateWords.map((word) => word[0]).join("");

    if (compactCandidate === compactQuery) {
        return 1000;
    }

    if (compactCandidate.startsWith(compactQuery)) {
        return 850 - compactCandidate.length;
    }

    if (initials === compactQuery) {
        return 760 - candidateWords.length * 15 - compactCandidate.length;
    }

    if (initials.startsWith(compactQuery)) {
        return 680 - candidateWords.length * 10 - compactCandidate.length;
    }

    let score = 0;
    let wordIndex = 0;
    let firstMatchedIndex = -1;
    let matchedPrefixCount = 0;
    let totalSkippedWords = 0;

    for (const queryWord of queryWords) {
        let matchedIndex = -1;
        let matchQuality = Number.NEGATIVE_INFINITY;

        for (let index = wordIndex; index < candidateWords.length; index += 1) {
            const candidateWord = candidateWords[index];
            const skippedWords = index - wordIndex;

            if (candidateWord.startsWith(queryWord)) {
                const quality =
                    160 -
                    (candidateWord.length - queryWord.length) -
                    skippedWords * 20;

                if (quality > matchQuality) {
                    matchedIndex = index;
                    matchQuality = quality;
                }
            }

            if (candidateWord.includes(queryWord)) {
                const quality =
                    90 -
                    (candidateWord.length - queryWord.length) -
                    skippedWords * 20 -
                    candidateWord.indexOf(queryWord) * 5;

                if (quality > matchQuality) {
                    matchedIndex = index;
                    matchQuality = quality;
                }
            }
        }

        if (matchedIndex === -1) {
            score = -1;
            break;
        }

        if (firstMatchedIndex === -1) {
            firstMatchedIndex = matchedIndex;
        }

        totalSkippedWords += matchedIndex - wordIndex;
        if (candidateWords[matchedIndex].startsWith(queryWord)) {
            matchedPrefixCount += 1;
        }

        score += matchQuality;
        wordIndex = matchedIndex + 1;
    }

    if (score >= 0) {
        return (
            score +
            queryWords.length * 25 +
            matchedPrefixCount * 35 -
            totalSkippedWords * 25 -
            firstMatchedIndex * 20 -
            (candidateWords.length - queryWords.length) * 10
        );
    }

    if (isSubsequence(compactQuery, initials)) {
        return 520 - initials.length * 15 - compactCandidate.length;
    }

    if (compactCandidate.includes(compactQuery)) {
        return 300 - compactCandidate.indexOf(compactQuery);
    }

    if (isSubsequence(compactQuery, compactCandidate)) {
        return 120 - compactCandidate.length;
    }

    return null;
}

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

    private async showSearchableQuickPick<T extends SearchableQuickPickItem>(
        items: T[],
        options: {
            placeHolder: string;
            title?: string;
        },
    ): Promise<T | undefined> {
        return new Promise<T | undefined>((resolve) => {
            const quickPick = vscode.window.createQuickPick<T>();
            let isResolved = false;

            const finalize = (value: T | undefined): void => {
                if (isResolved) {
                    return;
                }

                isResolved = true;
                resolve(value);
                quickPick.dispose();
            };

            const updateItems = (): void => {
                const filteredItems = items
                    .map((item) => ({
                        item,
                        score: getLooseMatchScore(
                            item.searchText,
                            quickPick.value,
                        ),
                    }))
                    .filter(
                        ({ item, score }) => item.isPinned || score !== null,
                    )
                    .sort((left, right) => {
                        if (left.item.isPinned && !right.item.isPinned) {
                            return -1;
                        }

                        if (!left.item.isPinned && right.item.isPinned) {
                            return 1;
                        }

                        return (
                            (right.score ?? 0) - (left.score ?? 0) ||
                            left.item.label.localeCompare(right.item.label)
                        );
                    })
                    .map(({ item }): T => ({ ...item, alwaysShow: true }));

                quickPick.items = filteredItems;

                if (filteredItems.length > 0) {
                    quickPick.activeItems = [filteredItems[0]];
                }
            };

            quickPick.placeholder = options.placeHolder;
            quickPick.title = options.title;
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            quickPick.onDidChangeValue(updateItems);
            quickPick.onDidAccept(() => {
                const selection =
                    quickPick.selectedItems[0] ?? quickPick.activeItems[0];
                finalize(selection);
            });
            quickPick.onDidHide(() => {
                finalize(undefined);
            });

            updateItems();
            quickPick.show();
        });
    }

    /**
     * Show search dialog
     */
    async showSearchDialog(): Promise<void> {
        try {
            // Get all available nodes for autocomplete, excluding extensions
            const nodes = this.parser
                .getNodes()
                .filter((n) => n.type !== "extension");
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
                const nodeItems: SearchableQuickPickItem[] = nodeNames.map(
                    (name) => ({
                        label: name,
                        description: splitIdentifierWords(name).join(" "),
                        searchText: name,
                        alwaysShow: true,
                    }),
                );
                const selectedNode = await this.showSearchableQuickPick(
                    nodeItems,
                    {
                        placeHolder: "Select a Xtrem node...",
                    },
                );

                if (!selectedNode) {
                    return;
                }

                const selectedNodeName = selectedNode.searchText;
                const nodeClass = this.parser.getNode(selectedNodeName);
                if (!nodeClass) {
                    return;
                }

                const direction: "upstream" | "downstream" =
                    nodeClass.type === "subNode" ? "upstream" : "downstream";

                // Step 2: Select property (including inherited ones)
                const allProperties =
                    this.parser.getAllProperties(selectedNodeName);
                const propertyNames = Array.from(allProperties.keys()).sort();

                if (propertyNames.length === 0) {
                    vscode.window.showInformationMessage(
                        `No properties found in node ${selectedNodeName}`,
                    );
                    return;
                }

                const propertyItems: SearchableQuickPickItem[] = [
                    {
                        ...backItem,
                        isPinned: true,
                        alwaysShow: true,
                        searchText: backItem.label,
                    },
                    ...propertyNames.map((name) => ({
                        label: name,
                        description: splitIdentifierWords(name).join(" "),
                        searchText: name,
                        alwaysShow: true,
                    })),
                ];

                const selectedProperty = await this.showSearchableQuickPick(
                    propertyItems,
                    {
                        placeHolder: `Select a property from ${selectedNodeName}...`,
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
                    selectedNodeName,
                    selectedProperty.searchText,
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
        await this.showSearchDialog();
    }
}
