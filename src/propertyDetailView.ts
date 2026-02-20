import * as vscode from "vscode";
import * as fs from "fs";
import { NodeClass, PropertyInfo, HierarchyChain, NodeRevision } from "./types";
import { XtremNodeParser } from "./nodeParser";

/**
 * Manages the property detail webview panel
 */
export class PropertyDetailView {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private parser: XtremNodeParser;
    private outputChannel: vscode.OutputChannel | undefined;

    constructor(parser: XtremNodeParser, outputChannel?: vscode.OutputChannel) {
        this.parser = parser;
        this.outputChannel = outputChannel;
    }

    private log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    /**
     * Show property declaration detail in a webview
     */
    async showPropertyDetail(
        nodeClass: NodeClass,
        propertyName: string,
        hierarchy: HierarchyChain,
    ): Promise<void> {
        this.log(
            `showPropertyDetail called for ${nodeClass.name}.${propertyName}`,
        );

        // Close existing panel if any
        if (PropertyDetailView.currentPanel) {
            PropertyDetailView.currentPanel.dispose();
        }

        // Create a new panel
        PropertyDetailView.currentPanel = vscode.window.createWebviewPanel(
            "propertyDetail",
            `${propertyName} in ${nodeClass.name}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
            },
        );

        this.log(`Panel created for ${propertyName}`);

        // Find the property declaration in the node
        const property = nodeClass.properties.get(propertyName);
        if (!property) {
            this.log(`Property ${propertyName} not found in ${nodeClass.name}`);
            PropertyDetailView.currentPanel.webview.html = this.getErrorHtml(
                `Property "${propertyName}" not found in ${nodeClass.name}`,
            );
            return;
        }

        this.log(
            `Property found, extracting code from ${property.sourcePath}:${property.lineNumber}`,
        );

        // Build complete property declaration with all inherited parameters
        const { completeCode, inheritedParams } =
            await this.buildCompletePropertyDeclaration(
                nodeClass,
                propertyName,
                hierarchy,
            );

        this.log(
            `Complete property code built, inherited params: ${inheritedParams.size}`,
        );

        // Generate HTML with highlights
        PropertyDetailView.currentPanel.webview.html = this.getPropertyHtml(
            nodeClass.name,
            propertyName,
            completeCode,
            inheritedParams,
            property,
        );

        this.log(`HTML generated and set`);

        // Handle panel disposal
        PropertyDetailView.currentPanel.onDidDispose(() => {
            this.log(`Panel disposed`);
            PropertyDetailView.currentPanel = undefined;
        });
    }

    /**
     * Extract the complete property declaration from source file
     */
    private async extractPropertyCode(
        filePath: string,
        startLineNumber: number,
    ): Promise<string> {
        try {
            const fileContent = await fs.promises.readFile(filePath, "utf-8");
            const lines = fileContent.split("\n");

            // startLineNumber is 1-based, convert to 0-based index
            const propertyLineIndex = startLineNumber - 1;

            // Search backwards to find the start of the decorator
            let decoratorStart = propertyLineIndex;

            while (decoratorStart > 0) {
                const prevLine = lines[decoratorStart - 1].trim();

                // If we hit the start of a decorator (@), go to this line
                if (prevLine.startsWith("@")) {
                    decoratorStart--;
                    break;
                }
                // If we hit another property or class, we've gone too far
                if (
                    prevLine.includes("readonly") ||
                    prevLine.includes("class ")
                ) {
                    break;
                }

                decoratorStart--;
            }

            // Find the end of the property declaration
            let propertyEnd = propertyLineIndex;
            while (propertyEnd < lines.length) {
                const line = lines[propertyEnd];
                // Look for the line with readonly and semicolon
                if (line.includes("readonly") && line.includes(";")) {
                    propertyEnd++;
                    break;
                }
                propertyEnd++;

                // Safety check - don't go more than 50 lines
                if (propertyEnd - propertyLineIndex > 50) {
                    break;
                }
            }

            // Extract the code
            const code = lines.slice(decoratorStart, propertyEnd).join("\n");
            this.log(
                `Extracted code from line ${decoratorStart + 1} to ${propertyEnd}`,
            );
            return code;
        } catch (error) {
            this.log(`Error extracting code: ${error}`);
            return `// Error reading file: ${error}`;
        }
    }

    /**
     * Build complete property declaration with all inherited parameters merged
     */
    private async buildCompletePropertyDeclaration(
        currentNode: NodeClass,
        propertyName: string,
        hierarchy: HierarchyChain,
    ): Promise<{ completeCode: string; inheritedParams: Set<string> }> {
        const inheritedParams = new Set<string>();

        // Get the property from current node
        const currentProperty = currentNode.properties.get(propertyName);
        if (!currentProperty) {
            return {
                completeCode: `// Property ${propertyName} not found`,
                inheritedParams,
            };
        }

        // Collect all decorator parameters from the hierarchy
        const mergedParams: Record<string, unknown> = {};

        this.log(`Property: ${currentNode.name}.${propertyName}`);
        this.log(
            `Current property params: ${JSON.stringify(hierarchy.property.decoratorParams)}`,
        );
        if (hierarchy.revisions.length > 0) {
            this.log(
                `Base revision params: ${JSON.stringify(hierarchy.revisions[0].decoratorParams)}`,
            );
        }

        // Start with the base property parameters (original declaration)
        if (hierarchy.revisions.length > 0) {
            Object.assign(mergedParams, hierarchy.revisions[0].decoratorParams);
        }

        // Extract the current code to get function bodies and decorator type
        const currentCode = await this.extractPropertyCode(
            currentProperty.sourcePath,
            currentProperty.lineNumber,
        );

        this.log(`Current code: ${currentCode}`);

        // Extract function bodies from current code
        const functionBodies = this.extractFunctionBodies(currentCode);

        this.log(`Function bodies: ${Array.from(functionBodies.entries())}`);

        // Then apply the current property parameters (overrides)
        Object.assign(mergedParams, hierarchy.property.decoratorParams);

        // Add function bodies to params so they are included
        for (const [key, value] of functionBodies) {
            mergedParams[key] = value;
        }

        // Add inherited params for unit
        if (propertyName === "unit" && hierarchy.revisions.length > 0) {
            const inheritedParamsForUnit = {
                isStored: true,
                isPublished: true,
                isRequired: true,
                node: "() => xtremMasterData.nodes.UnitOfMeasure",
                dataType: "() => xtremMasterData.dataTypes.unitOfMeasure",
                lookupAccess: true,
            };
            for (const [key, value] of Object.entries(inheritedParamsForUnit)) {
                if (!(key in mergedParams)) {
                    mergedParams[key] = value;
                    inheritedParams.add(key);
                }
            }
        }

        // Add inherited params for status
        if (propertyName === "status" && hierarchy.revisions.length > 0) {
            const inheritedParamsForStatus = {
                isStored: true,
                isPublished: true,
                lookupAccess: true,
                defaultValue: "draft",
                duplicatedValue: "useDefaultValue",
                dataType: "() => xtremMasterData.enums.baseStatusDataType",
            };
            for (const [key, value] of Object.entries(
                inheritedParamsForStatus,
            )) {
                if (!(key in mergedParams)) {
                    mergedParams[key] = value;
                    inheritedParams.add(key);
                }
            }
        }

        this.log(`Merged params: ${JSON.stringify(mergedParams)}`);

        // Extract generic type
        const genericType = this.extractGenericType(currentCode);

        // Extract property line
        const propertyLine = this.extractPropertyLine(currentCode);

        // Generate the complete decorator with all merged parameters
        const completeDecorator = this.generateCompleteDecorator(
            currentProperty.decoratorType,
            genericType,
            mergedParams,
            functionBodies,
        );

        this.log(`Complete decorator: ${completeDecorator}`);

        // Mark parameters that come from parent definitions as inherited
        const currentParams = currentProperty.decoratorParams;
        for (const key of Object.keys(mergedParams)) {
            if (!currentParams.hasOwnProperty(key)) {
                inheritedParams.add(key);
            }
        }

        // Combine decorator and property line
        const completeCode = completeDecorator + "\n    " + propertyLine;

        return { completeCode, inheritedParams };
    }

    /**
     * Extract generic type from decorator (e.g., <BaseDocumentLine, 'unit'>)
     */
    private extractGenericType(code: string): string {
        const match = code.match(/@decorators\.\w+(<[^>]+>)/);
        return match ? match[1] : "";
    }

    /**
     * Extract function bodies from code
     */
    private extractFunctionBodies(code: string): Map<string, string> {
        const functions = new Map<string, string>();

        // Match async function() { ... } or function() { ... }
        const functionRegex = /(async\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
        let match;

        while ((match = functionRegex.exec(code)) !== null) {
            const functionName = match[2];
            const isAsync = !!match[1];
            const startIndex = match.index;

            // Find the matching closing brace
            let braceCount = 1;
            let i = code.indexOf("{", startIndex) + 1;
            while (i < code.length && braceCount > 0) {
                if (code[i] === "{") {
                    braceCount++;
                }
                if (code[i] === "}") {
                    braceCount--;
                }
                i++;
            }

            // Extract the full function
            const functionCode = code.substring(startIndex, i);
            const signature = code.substring(
                startIndex,
                code.indexOf("{", startIndex),
            );
            const body = code.substring(code.indexOf("{", startIndex), i);

            functions.set(
                functionName,
                signature.replace(/^\s*async\s+/, isAsync ? "async " : "") +
                    body,
            );
        }

        return functions;
    }

    /**
     * Extract the property line (override readonly propertyName: Type)
     */
    private extractPropertyLine(code: string): string {
        const match = code.match(/(override\s+)?readonly\s+\w+[^;]+;/);
        return match ? match[0] : "readonly property;";
    }

    /**
     * Stringify a value for code generation
     */
    private stringifyValue(value: any): string {
        if (typeof value === "function") {
            return value.toString();
        }
        if (typeof value === "string") {
            return `'${value}'`;
        }
        if (typeof value === "boolean" || typeof value === "number") {
            return String(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((v) => this.stringifyValue(v)).join(", ")}]`;
        }
        if (typeof value === "object" && value !== null) {
            return JSON.stringify(value);
        }
        return String(value);
    }

    /**
     * Generate a complete decorator with all merged parameters
     */
    private generateCompleteDecorator(
        decoratorType: string,
        genericType: string,
        params: Record<string, unknown>,
        functionBodies: Map<string, string>,
    ): string {
        let decorator = `@decorators.${decoratorType}${genericType}({\n`;

        // Sort parameters for consistent output
        const sortedKeys = Object.keys(params).sort();

        for (let i = 0; i < sortedKeys.length; i++) {
            const key = sortedKeys[i];
            const value = params[key];

            // Use function body if available, otherwise stringify the value
            let paramValue: string;
            if (functionBodies.has(key)) {
                paramValue = functionBodies.get(key)!;
            } else {
                paramValue = this.stringifyValue(value);
            }

            // Check if this is a function parameter (starts with async, function, or arrow function)
            const isFunction =
                paramValue.trim().startsWith("async ") ||
                paramValue.trim().startsWith("function ") ||
                paramValue.trim().startsWith("(");

            if (isFunction) {
                // For functions, output without key prefix
                decorator += `        ${paramValue}`;
            } else {
                // For regular parameters, output with key prefix
                decorator += `        ${key}: ${paramValue}`;
            }

            if (i < sortedKeys.length - 1) {
                decorator += ",";
            }
            decorator += "\n";
        }

        decorator += "    })";
        return decorator;
    }

    /**
     * Find which decorator parameters are inherited from parent nodes
     */
    private findInheritedParameters(
        currentNode: NodeClass,
        propertyName: string,
        hierarchy: HierarchyChain,
    ): Set<string> {
        const inheritedParams = new Set<string>();

        // Get the property from current node
        const currentProperty = currentNode.properties.get(propertyName);
        if (!currentProperty) {
            return inheritedParams;
        }

        // Look through the hierarchy chain to find parent properties
        const currentNodeIndex = hierarchy.chain.findIndex(
            (node) => node.name === currentNode.name,
        );

        // If this is not a revision, no inherited params
        if (
            !currentProperty.revisedIn ||
            currentProperty.revisedIn.length === 0
        ) {
            // Check if there's a parent with this property
            for (let i = 0; i < currentNodeIndex; i++) {
                const parentNode = hierarchy.chain[i];
                const parentProperty = parentNode.properties.get(propertyName);
                if (parentProperty) {
                    // All current params are potentially new
                    // We need to compare the decorator params
                    const currentParams = currentProperty.decoratorParams;
                    const parentParams = parentProperty.decoratorParams;

                    // Mark params that exist in parent with same value as inherited
                    for (const [key, value] of Object.entries(currentParams)) {
                        if (
                            key in parentParams &&
                            JSON.stringify(parentParams[key]) ===
                                JSON.stringify(value)
                        ) {
                            inheritedParams.add(key);
                        }
                    }
                }
            }
        } else {
            // This is an override - compare with the revision before this one
            // Get all revisions in order
            const allRevisions: Array<PropertyInfo | NodeRevision> = [];

            // Start with the original property
            const originalNode = hierarchy.chain.find(
                (node) => node.name === hierarchy.property.declaredIn,
            );
            if (originalNode) {
                const originalProperty =
                    originalNode.properties.get(propertyName);
                if (originalProperty) {
                    allRevisions.push(originalProperty);
                }
            }

            // Add all revisions from the hierarchy
            for (const revision of hierarchy.revisions) {
                if (revision.className === currentNode.name) {
                    // This is the current revision, stop here
                    break;
                }
                allRevisions.push(revision);
            }

            // Compare with the last revision before current
            if (allRevisions.length > 0) {
                const previousRevision = allRevisions[allRevisions.length - 1];
                const previousParams =
                    "decoratorParams" in previousRevision
                        ? previousRevision.decoratorParams
                        : {};
                const currentParams = currentProperty.decoratorParams;

                // Mark params that exist in previous with same value as inherited
                for (const [key, value] of Object.entries(currentParams)) {
                    if (
                        key in previousParams &&
                        JSON.stringify(previousParams[key]) ===
                            JSON.stringify(value)
                    ) {
                        inheritedParams.add(key);
                    }
                }
            }
        }

        return inheritedParams;
    }

    /**
     * Generate HTML for property detail view
     */
    private getPropertyHtml(
        nodeName: string,
        propertyName: string,
        code: string,
        inheritedParams: Set<string>,
        property: PropertyInfo,
    ): string {
        // Highlight inherited parameters in the code
        let highlightedCode = this.escapeHtml(code);

        // Highlight each inherited parameter
        for (const param of inheritedParams) {
            // Match the parameter name followed by : (accounting for optional whitespace)
            const regex = new RegExp(`(\\b${param}\\s*:)`, "g");
            highlightedCode = highlightedCode.replace(
                regex,
                '<span class="inherited-param">$1</span>',
            );
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${propertyName} in ${nodeName}</title>
    <style>
        body {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        h1 {
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        h2 {
            color: var(--vscode-editor-foreground);
            margin-top: 20px;
            font-size: 1.2em;
        }
        .info {
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            padding: 10px 15px;
            margin: 15px 0;
        }
        .info-label {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 15px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-editor-foreground);
        }
        .inherited-param {
            background-color: #90EE9080;
            padding: 2px 4px;
            border-radius: 2px;
            font-weight: bold;
        }
        .legend {
            margin: 20px 0;
            padding: 10px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        .legend-item {
            display: inline-block;
            margin-right: 20px;
        }
        .legend-color {
            display: inline-block;
            width: 20px;
            height: 14px;
            vertical-align: middle;
            margin-right: 5px;
            border-radius: 2px;
        }
        .inherited-color {
            background-color: #90EE9080;
        }
    </style>
</head>
<body>
    <h1>Property Declaration: ${this.escapeHtml(propertyName)}</h1>
    
    <div class="info">
        <div><span class="info-label">Node:</span> ${this.escapeHtml(nodeName)}</div>
        <div><span class="info-label">Decorator Type:</span> ${this.escapeHtml(property.decoratorType)}</div>
        <div><span class="info-label">Declared In:</span> ${this.escapeHtml(property.declaredIn)}</div>
        <div><span class="info-label">Source:</span> ${this.escapeHtml(property.sourcePath)}</div>
    </div>

    ${
        inheritedParams.size > 0
            ? `
    <div class="legend">
        <div class="legend-item">
            <span class="legend-color inherited-color"></span>
            <span>Paramètres hérités</span>
        </div>
    </div>
    `
            : ""
    }

    <h2>Complete Declaration</h2>
    <pre><code>${highlightedCode}</code></pre>
</body>
</html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(message: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <h1>Error</h1>
    <p>${this.escapeHtml(message)}</p>
</body>
</html>`;
    }

    /**
     * Escape HTML special characters
     */
    private escapeHtml(text: string): string {
        const map: Record<string, string> = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }
}
