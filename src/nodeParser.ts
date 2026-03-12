import * as vscode from "vscode";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { NodeClass, PropertyInfo, HierarchyChain } from "./types";

/**
 * Extract package name from file path (e.g., 'xtrem-master-data' from path)
 */
function extractPackageName(filePath: string): string | undefined {
    const parts = filePath.split(path.sep);
    // Find the last directory that starts with 'xtrem-'
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].startsWith("xtrem-")) {
            return parts[i];
        }
    }
    return undefined;
}

/**
 * Get package root path from file path
 */
function getPackageRoot(filePath: string): string | undefined {
    const parts = filePath.split(path.sep);
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].startsWith("xtrem-")) {
            return parts.slice(0, i + 1).join(path.sep);
        }
    }
    return undefined;
}

/**
 * Parser for extracting node definitions and property information from TypeScript files
 * Uses TypeScript Compiler API for accurate parsing
 */
export class XtremNodeParser {
    private nodeCache: Map<string, NodeClass> = new Map();
    // Maps base node name (e.g. "Item") to all its extension NodeClasses
    private extensionCache: Map<string, NodeClass[]> = new Map();
    private workspaceFolder: string;
    private program: ts.Program | undefined;
    private checker: ts.TypeChecker | undefined;
    private packageDependencies: Map<string, Set<string>> = new Map();
    private outputChannel: vscode.OutputChannel | undefined;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.workspaceFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
        this.outputChannel = outputChannel;
    }

    private log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.nodeCache.clear();
        this.extensionCache.clear();
        this.program = undefined;
        this.checker = undefined;
        this.packageDependencies.clear();
    }

    /**
     * Load package.json dependencies for a package
     */
    private async loadPackageDependencies(
        packageRoot: string,
    ): Promise<Set<string>> {
        const dependencies = new Set<string>();
        const packageJsonPath = path.join(packageRoot, "package.json");

        try {
            const content = await fs.promises.readFile(
                packageJsonPath,
                "utf-8",
            );
            const packageJson = JSON.parse(content);

            // Get all dependencies (dependencies + devDependencies)
            const allDeps = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies,
            };

            // Filter only xtrem-* packages
            for (const dep of Object.keys(allDeps)) {
                let pkgName = "";
                if (dep.startsWith("@sage/xtrem-")) {
                    // Extract package name (e.g., '@sage/xtrem-core' -> 'xtrem-core')
                    pkgName = dep.replace("@sage/", "");
                } else if (dep.startsWith("xtrem-")) {
                    pkgName = dep;
                }
                if (pkgName) {
                    dependencies.add(pkgName);
                }
            }
        } catch (error) {
            // Ignore errors if package.json doesn't exist
            this.log(`Could not load package.json for ${packageRoot}`);
        }

        return dependencies;
    }

    /**
     * Parse all TypeScript files in the workspace to extract node definitions
     * Uses TypeScript Compiler API for accurate parsing
     */
    async parseWorkspace(): Promise<Map<string, NodeClass>> {
        this.log("Starting TypeScript-based workspace parsing...");

        // Search for TypeScript files in nodes, node-extensions, and examples directories
        const patterns = [
            "**/nodes/**/*.ts",
            "**/node-extensions/**/*.ts",
            "**/examples/**/*.ts",
        ];
        const excludePattern = "**/node_modules/**";

        const allFiles: vscode.Uri[] = [];

        for (const pattern of patterns) {
            const tsFiles = await vscode.workspace.findFiles(
                pattern,
                excludePattern,
            );
            allFiles.push(...tsFiles);
            if (tsFiles.length > 0) {
                this.log(`Pattern "${pattern}" found ${tsFiles.length} files`);
            }
        }

        // Remove duplicates
        const uniqueFiles = Array.from(
            new Map(allFiles.map((f) => [f.fsPath, f])).values(),
        );

        this.log(
            `Found ${uniqueFiles.length} TypeScript files in nodes directories`,
        );

        if (uniqueFiles.length === 0) {
            this.log(
                "No files found in nodes directories. Falling back to all TS files...",
            );
            // Fallback: search all TS files if nothing found in nodes dirs
            const allTsFiles = await vscode.workspace.findFiles(
                "**/*.ts",
                excludePattern,
            );
            uniqueFiles.push(...allTsFiles);
            this.log(
                `Fallback: found ${allTsFiles.length} total TypeScript files`,
            );
        }

        // Create TypeScript program
        const fileNames = uniqueFiles.map((f) => f.fsPath);
        const compilerOptions: ts.CompilerOptions = {
            target: ts.ScriptTarget.Latest,
            module: ts.ModuleKind.CommonJS,
            allowJs: true,
            noEmit: true,
        };

        this.program = ts.createProgram(fileNames, compilerOptions);
        this.checker = this.program.getTypeChecker();

        // Parse each file
        let nodeCount = 0;
        const packageRoots = new Set<string>();
        for (const sourceFile of this.program.getSourceFiles()) {
            if (
                !sourceFile.isDeclarationFile &&
                fileNames.includes(sourceFile.fileName)
            ) {
                nodeCount += this.parseSourceFile(sourceFile);
                // Track package roots
                const pkgRoot = getPackageRoot(sourceFile.fileName);
                if (pkgRoot) {
                    packageRoots.add(pkgRoot);
                }
            }
        }

        // Load package dependencies
        this.log(`Loading dependencies for ${packageRoots.size} packages...`);
        for (const pkgRoot of packageRoots) {
            const pkgName = extractPackageName(pkgRoot);
            if (pkgName) {
                const deps = await this.loadPackageDependencies(pkgRoot);
                this.packageDependencies.set(pkgName, deps);
                if (deps.size > 0) {
                    this.log(
                        `  ${pkgName} depends on: ${Array.from(deps).join(", ")}`,
                    );
                }
            }
        }
        this.log(
            `Package dependencies loaded. Map size: ${this.packageDependencies.size}`,
        );
        for (const [pkg, deps] of this.packageDependencies) {
            this.log(`  ${pkg}: [${Array.from(deps).join(", ")}]`);
        }

        this.log(`Parsing complete. Total nodes found: ${nodeCount}`);
        return this.nodeCache;
    }

    /**
     * Parse a single TypeScript source file using AST
     */
    private parseSourceFile(sourceFile: ts.SourceFile): number {
        let nodeCount = 0;

        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node) && node.name) {
                const className = node.name.text;
                const decorators = ts.getDecorators(node);

                if (decorators) {
                    for (const decorator of decorators) {
                        const nodeType = this.getNodeDecoratorType(decorator);
                        if (nodeType) {
                            // Found a node class!
                            let extendedClass = this.getExtendedClass(node);
                            // For extension types, prefer the Xtrem parent declared in the
                            // decorator's `extends` parameter (e.g. subNodeExtension4 passes
                            // the real parent via `extends: () => pkg.nodes.ParentNode` while
                            // the TypeScript `extends` clause only refers to a generic base class).
                            if (nodeType === "extension") {
                                const decoratorParent =
                                    this.getExtendedClassFromDecorator(
                                        decorator,
                                    );
                                if (decoratorParent) {
                                    extendedClass = decoratorParent;
                                }
                            }
                            const lineNumber =
                                sourceFile.getLineAndCharacterOfPosition(
                                    node.getStart(),
                                ).line + 1;

                            const nodeClass: NodeClass = {
                                name: className,
                                type: nodeType,
                                sourcePath: sourceFile.fileName,
                                lineNumber: lineNumber,
                                packageName: extractPackageName(
                                    sourceFile.fileName,
                                ),
                                extends: extendedClass,
                                properties: new Map(),
                            };

                            // Extract properties using TypeScript API
                            this.extractProperties(node, nodeClass, sourceFile);

                            this.nodeCache.set(className, nodeClass);
                            // Also register extensions in extensionCache. Multiple extensions with the
                            // same base name (e.g. "ItemExtension") can exist across different packages,
                            // so we store them in an array keyed by the base node name.
                            if (nodeType === "extension") {
                                // Prefer the resolved extendedClass (may come from decorator param)
                                // as the cache key; fall back to stripping the "Extension" suffix.
                                let baseName = extendedClass;
                                if (!baseName && className.endsWith("Extension")) {
                                    baseName = className.slice(
                                        0,
                                        -"Extension".length,
                                    );
                                }
                                if (baseName) {
                                    if (!this.extensionCache.has(baseName)) {
                                        this.extensionCache.set(baseName, []);
                                    }
                                    this.extensionCache.get(baseName)!.push(nodeClass);
                                }
                            }
                            nodeCount++;
                            this.log(
                                `Found node: ${className} with ${nodeClass.properties.size} properties (extends: ${extendedClass || "none"})`,
                            );
                            break;
                        }
                    }
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return nodeCount;
    }

    /**
     * Check if decorator is a node decorator and return its type
     */
    private getNodeDecoratorType(
        decorator: ts.Decorator,
    ): "node" | "subNode" | "extension" | null {
        const expression = decorator.expression;
        let decoratorText = "";

        if (ts.isCallExpression(expression)) {
            decoratorText = expression.expression.getText();
        } else {
            decoratorText = expression.getText();
        }

        // Check subNodeExtension / nodeExtension BEFORE subNode / node to avoid
        // false positives (e.g. "subNodeExtension4" contains "subNode").
        if (
            decoratorText.match(
                /@?decorators\.subNodeExtension|@?subNodeExtension/i,
            )
        ) {
            return "extension";
        }
        if (
            decoratorText.match(/@?decorators\.nodeExtension|@?nodeExtension/i)
        ) {
            return "extension";
        }
        // Check for various patterns: @decorators.node, @decorators.subNode, etc.
        if (decoratorText.match(/@?decorators\.subNode|@?subNode/i)) {
            return "subNode";
        }
        if (decoratorText.match(/@?decorators\.node|@?node/i)) {
            return "node";
        }

        return null;
    }

    /**
     * Get the name of the extended class
     */
    private getExtendedClass(node: ts.ClassDeclaration): string | undefined {
        if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
                if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
                    const type = clause.types[0];
                    if (type && ts.isIdentifier(type.expression)) {
                        return type.expression.text;
                    }
                    if (
                        type &&
                        ts.isPropertyAccessExpression(type.expression)
                    ) {
                        // Handle qualified names like xtremMasterData.nodes.BaseDocumentItemLine
                        return type.expression.name.text;
                    }
                    if (type) {
                        // Fallback to text if we can't normalize
                        return type.expression.getText();
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Extract the Xtrem parent node name from the decorator's `extends` parameter.
     * Used for extension decorators like @decorators.subNodeExtension4 where the
     * TypeScript class extends a generic base (e.g. SubNodeExtension4) but the
     * actual Xtrem parent is declared via `extends: () => pkg.nodes.ParentNode`.
     */
    private getExtendedClassFromDecorator(
        decorator: ts.Decorator,
    ): string | undefined {
        const expression = decorator.expression;
        if (
            !ts.isCallExpression(expression) ||
            expression.arguments.length === 0
        ) {
            return undefined;
        }
        const firstArg = expression.arguments[0];
        if (!ts.isObjectLiteralExpression(firstArg)) {
            return undefined;
        }
        for (const prop of firstArg.properties) {
            if (
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === "extends"
            ) {
                const val = prop.initializer;
                // Arrow function: () => pkg.nodes.ParentNode  or  () => ParentNode
                if (ts.isArrowFunction(val)) {
                    const body = val.body;
                    if (ts.isPropertyAccessExpression(body)) {
                        return body.name.text;
                    }
                    if (ts.isIdentifier(body)) {
                        return body.text;
                    }
                }
                // Direct property access: pkg.nodes.ParentNode
                if (ts.isPropertyAccessExpression(val)) {
                    return val.name.text;
                }
                // Identifier: ParentNode
                if (ts.isIdentifier(val)) {
                    return val.text;
                }
            }
        }
        return undefined;
    }

    /**
     * Extract properties from a class using TypeScript API
     */
    private extractProperties(
        classNode: ts.ClassDeclaration,
        nodeClass: NodeClass,
        sourceFile: ts.SourceFile,
    ): void {
        if (!this.checker) {
            return;
        }

        for (const member of classNode.members) {
            if (ts.isPropertyDeclaration(member) && member.name) {
                const propertyName = member.name.getText();

                // Skip private members
                if (
                    member.modifiers?.some(
                        (m) => m.kind === ts.SyntaxKind.PrivateKeyword,
                    )
                ) {
                    continue;
                }

                // Get decorator info
                let decoratorType = "field";
                let decoratorParams: Record<string, unknown> = {};
                const decorators = ts.getDecorators(member);
                if (decorators && decorators.length > 0) {
                    const decorator = decorators[0];
                    const decoratorName = this.getDecoratorName(decorator);
                    if (decoratorName) {
                        decoratorType = decoratorName;
                    }
                    // Parse decorator parameters
                    decoratorParams = this.parseDecoratorParams(decorator);
                }

                // Get type information
                const type = member.type ? member.type.getText() : "any";

                const readonlyToken = member.modifiers?.find(
                    (modifier) =>
                        modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
                );
                const anchor = readonlyToken ?? member.name;
                const lineNumber =
                    sourceFile.getLineAndCharacterOfPosition(
                        anchor.getStart(sourceFile),
                    ).line + 1;

                const propertyInfo: PropertyInfo = {
                    name: propertyName,
                    decoratorType: decoratorType,
                    decoratorParams: decoratorParams,
                    declaredIn: nodeClass.name,
                    sourcePath: sourceFile.fileName,
                    lineNumber: lineNumber,
                };

                nodeClass.properties.set(propertyName, propertyInfo);
            }
        }
    }

    /**
     * Extract decorator name from a decorator node
     */
    private getDecoratorName(decorator: ts.Decorator): string | null {
        const expression = decorator.expression;

        if (ts.isCallExpression(expression)) {
            const callee = expression.expression;
            if (ts.isPropertyAccessExpression(callee)) {
                // @decorators.referenceProperty() -> "referenceProperty"
                return callee.name.text;
            } else if (ts.isIdentifier(callee)) {
                // @referenceProperty() -> "referenceProperty"
                return callee.text;
            }
        } else if (ts.isPropertyAccessExpression(expression)) {
            // @decorators.referenceProperty -> "referenceProperty"
            return expression.name.text;
        } else if (ts.isIdentifier(expression)) {
            // @referenceProperty -> "referenceProperty"
            return expression.text;
        }

        return null;
    }

    /**
     * Parse decorator parameters from a decorator call expression
     */
    private parseDecoratorParams(
        decorator: ts.Decorator,
    ): Record<string, unknown> {
        const params: Record<string, unknown> = {};
        const expression = decorator.expression;

        if (
            ts.isCallExpression(expression) &&
            expression.arguments.length > 0
        ) {
            const firstArg = expression.arguments[0];
            if (ts.isObjectLiteralExpression(firstArg)) {
                // Parse object literal properties
                this.log(`Parsing ${firstArg.properties.length} properties`);
                for (const property of firstArg.properties) {
                    if (
                        ts.isPropertyAssignment(property) &&
                        ts.isIdentifier(property.name)
                    ) {
                        const key = property.name.text;
                        const value = this.parseDecoratorValue(
                            property.initializer,
                        );
                        this.log(
                            `Parsed param ${key}: ${JSON.stringify(value)}`,
                        );
                        params[key] = value;
                    } else {
                        this.log(`Skipped property ${property.getText()}`);
                    }
                }
            }
        }

        this.log(`Final parsed params: ${JSON.stringify(params)}`);
        return params;
    }

    /**
     * Parse a decorator parameter value
     */
    private parseDecoratorValue(node: ts.Expression): unknown {
        if (ts.isStringLiteral(node)) {
            return node.text;
        }
        if (ts.isNumericLiteral(node)) {
            return parseFloat(node.text);
        }
        if (node.getText() === "true") {
            return true;
        }
        if (node.getText() === "false") {
            return false;
        }
        if (ts.isArrayLiteralExpression(node)) {
            return node.elements.map((element) =>
                this.parseDecoratorValue(element),
            );
        }
        if (ts.isObjectLiteralExpression(node)) {
            const obj: Record<string, unknown> = {};
            for (const property of node.properties) {
                if (
                    ts.isPropertyAssignment(property) &&
                    ts.isIdentifier(property.name)
                ) {
                    obj[property.name.text] = this.parseDecoratorValue(
                        property.initializer,
                    );
                }
            }
            return obj;
        }
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            // For functions, return the source text
            return node.getText();
        }
        if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) {
            // For identifiers and property access, return the text
            return node.getText();
        }
        if (ts.isCallExpression(node)) {
            // For function calls like () => xtremMasterData.nodes.UnitOfMeasure
            return node.getText();
        }

        // Fallback: return the text representation
        return node.getText();
    }

    /**
     * Search for a property in a specific node (upstream/downstream search)
     */
    async searchPropertyHierarchy(
        nodeName: string,
        propertyName: string,
        direction: "upstream" | "downstream" = "upstream",
    ): Promise<HierarchyChain | null> {
        // Ensure nodes are parsed
        if (this.nodeCache.size === 0) {
            await this.parseWorkspace();
        }

        const node = this.nodeCache.get(nodeName);
        if (!node) {
            return null;
        }

        const allProperties = this.getAllProperties(nodeName);
        const property = allProperties.get(propertyName);
        // For upstream search the property must exist on the starting node or one
        // of its ancestors; return null early if it does not.  For downstream
        // search the property may be introduced only in a subNode/extension that
        // is a descendant of the starting node, so we let the traversal proceed
        // and resolve the primary property from the first revision found.
        if (!property && direction === "upstream") {
            return null;
        }

        // Build the inheritance chain
        const chain: NodeClass[] = [];
        const revisions: PropertyInfo[] = [];

        if (direction === "upstream") {
            // Go up the inheritance chain starting from the selected node.
            let currentNode: NodeClass | undefined = node;
            while (currentNode) {
                chain.push(currentNode);

                const prop = currentNode.properties.get(propertyName);
                if (prop) {
                    revisions.push(prop);
                }

                // Move to parent using cache first
                currentNode = currentNode.extends
                    ? this.nodeCache.get(currentNode.extends)
                    : undefined;
            }

            // If we didn't find inherited properties, try using TypeScript type checker
            if (revisions.length <= 1 && this.checker && this.program) {
                const inheritedProps =
                    this.findInheritedPropertiesWithTypeChecker(
                        nodeName,
                        propertyName,
                    );
                for (const inheritedProp of inheritedProps) {
                    // Avoid duplicates
                    if (
                        !revisions.some(
                            (r) => r.declaredIn === inheritedProp.declaredIn,
                        )
                    ) {
                        revisions.push(inheritedProp);
                        // Also add to chain if not already there
                        const inheritedNode = this.nodeCache.get(
                            inheritedProp.declaredIn,
                        );
                        if (
                            inheritedNode &&
                            !chain.some((n) => n.name === inheritedNode.name)
                        ) {
                            chain.push(inheritedNode);
                        }
                    }
                }
            }

            // If still no inherited properties found, try to find them in examples
            if (revisions.length <= 1) {
                const exampleInheritedProps =
                    this.findInheritedPropertiesInExamples(
                        nodeName,
                        propertyName,
                    );
                for (const inheritedProp of exampleInheritedProps) {
                    // Avoid duplicates
                    if (
                        !revisions.some(
                            (r) => r.declaredIn === inheritedProp.declaredIn,
                        )
                    ) {
                        revisions.push(inheritedProp);
                        // Also add to chain if not already there
                        const inheritedNode = this.nodeCache.get(
                            inheritedProp.declaredIn,
                        );
                        if (
                            inheritedNode &&
                            !chain.some((n) => n.name === inheritedNode.name)
                        ) {
                            chain.push(inheritedNode);
                        }
                    }
                }
            }
        } else {
            // Go down the inheritance chain starting from the selected node.
            chain.push(node);

            const nodeProperty = node.properties.get(propertyName);
            if (nodeProperty) {
                revisions.push(nodeProperty);
            }

            this.findSubclassesRecursive(node, propertyName, chain, revisions);
        }

        // Resolve the primary property: use what getAllProperties found, or
        // fall back to the first revision discovered during traversal (covers
        // the downstream-only case where the property originates in a subNode
        // or extension rather than the node we started from).
        const resolvedProperty = property ?? revisions[0];
        if (!resolvedProperty) {
            return null;
        }

        return {
            property: resolvedProperty,
            chain: chain,
            revisions: revisions.map((p) => ({
                className: p.declaredIn,
                decoratorType: p.decoratorType,
                decoratorParams: p.decoratorParams,
                sourcePath: p.sourcePath,
                lineNumber: p.lineNumber,
            })),
        };
    }

    /**
     * Find inherited properties using TypeScript type checker
     */
    private findInheritedPropertiesWithTypeChecker(
        nodeName: string,
        propertyName: string,
    ): PropertyInfo[] {
        const inheritedProps: PropertyInfo[] = [];

        if (!this.checker || !this.program) {
            return inheritedProps;
        }

        // Find the source file and class declaration
        for (const sourceFile of this.program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile) {
                for (const statement of sourceFile.statements) {
                    if (ts.isClassDeclaration(statement) && statement.name) {
                        const className = statement.name.text;
                        if (className === nodeName) {
                            // Found the class, now inspect its type hierarchy
                            const classSymbol =
                                this.checker.getSymbolAtLocation(
                                    statement.name,
                                );
                            if (classSymbol) {
                                const classType =
                                    this.checker.getDeclaredTypeOfSymbol(
                                        classSymbol,
                                    );
                                this.inspectTypeHierarchyForProperty(
                                    classType,
                                    propertyName,
                                    inheritedProps,
                                    new Set(),
                                );
                            }
                            break;
                        }
                    }
                }
            }
        }

        return inheritedProps;
    }

    /**
     * Recursively inspect type hierarchy for a property
     */
    private inspectTypeHierarchyForProperty(
        type: ts.Type,
        propertyName: string,
        inheritedProps: PropertyInfo[],
        visitedTypes: Set<string>,
    ): void {
        if (!type.symbol || visitedTypes.has(type.symbol.name)) {
            return;
        }

        visitedTypes.add(type.symbol.name);

        // Check if this type has the property
        const propertySymbol = type.getProperty(propertyName);
        if (propertySymbol) {
            // Check if it's declared in this type (not inherited)
            const declarations = propertySymbol.getDeclarations();
            if (declarations && declarations.length > 0) {
                const declaration = declarations[0];
                if (ts.isPropertyDeclaration(declaration)) {
                    // Extract decorator info
                    const decorators = ts.getDecorators(declaration);
                    if (decorators) {
                        for (const decorator of decorators) {
                            const decoratorName =
                                this.getDecoratorName(decorator);
                            if (decoratorName) {
                                const params =
                                    this.parseDecoratorParams(decorator);
                                const sourceFile = declaration.getSourceFile();
                                const lineNumber =
                                    sourceFile.getLineAndCharacterOfPosition(
                                        declaration.getStart(),
                                    ).line + 1;

                                const propInfo: PropertyInfo = {
                                    name: propertyName,
                                    decoratorType: decoratorName,
                                    decoratorParams: params,
                                    declaredIn: type.symbol.name,
                                    sourcePath: sourceFile.fileName,
                                    lineNumber: lineNumber,
                                };

                                // Avoid duplicates
                                if (
                                    !inheritedProps.some(
                                        (p) =>
                                            p.declaredIn ===
                                            propInfo.declaredIn,
                                    )
                                ) {
                                    inheritedProps.push(propInfo);
                                }
                                break; // Only take the first decorator
                            }
                        }
                    }
                }
            }
        }

        // Check base types
        if (type.isClassOrInterface()) {
            const baseTypes = this.checker!.getBaseTypes(type);
            for (const baseType of baseTypes) {
                this.inspectTypeHierarchyForProperty(
                    baseType,
                    propertyName,
                    inheritedProps,
                    visitedTypes,
                );
            }
        }
    }

    /**
     * Get all nodes in the workspace
     */
    getNodes(): NodeClass[] {
        return Array.from(this.nodeCache.values());
    }

    /**
     * Get a specific node
     */
    getNode(name: string): NodeClass | undefined {
        return this.nodeCache.get(name);
    }

    /**
     * Get the extension node for a given node, if one exists
     * e.g. for "Item" returns the first "ItemExtension" node found
     */
    getNodeExtension(nodeName: string): NodeClass | undefined {
        return this.extensionCache.get(nodeName)?.[0];
    }

    /**
     * Get all extension nodes for a given node (supports multiple packages)
     * e.g. for "Item" returns all nodes named "ItemExtension" across packages
     */
    getNodeExtensions(nodeName: string): NodeClass[] {
        return this.extensionCache.get(nodeName) ?? [];
    }

    /**
     * Get all properties of a node including inherited ones
     */
    getAllProperties(nodeName: string): Map<string, PropertyInfo> {
        const allProps = new Map<string, PropertyInfo>();
        const node = this.nodeCache.get(nodeName);

        if (!node) {
            return allProps;
        }

        // Collect properties from parent chain (bottom-up)
        const parentChain: NodeClass[] = [];
        let currentNode: NodeClass | undefined = node;

        // Build parent chain
        while (currentNode) {
            parentChain.unshift(currentNode); // Add to beginning
            currentNode = currentNode.extends
                ? this.nodeCache.get(currentNode.extends)
                : undefined;
        }

        // Add properties from top parent to current (child overrides parent)
        for (const classNode of parentChain) {
            for (const [propName, propInfo] of classNode.properties) {
                allProps.set(propName, propInfo);
            }
        }

        return allProps;
    }

    /**
     * Search for nodes containing a property name
     */
    searchNodesByProperty(propertyName: string): Map<string, NodeClass> {
        const results = new Map<string, NodeClass>();

        for (const [name, node] of this.nodeCache) {
            if (node.properties.has(propertyName)) {
                results.set(name, node);
            }
        }

        return results;
    }

    /**
     * Get the parent package that a package depends on (from available packages)
     * Returns the first dependency found that is also present in the hierarchy
     */
    getPackageParent(
        packageName: string,
        availablePackages: Set<string>,
    ): string | undefined {
        const deps = this.packageDependencies.get(packageName);
        if (!deps) {
            return undefined;
        }

        // Return the first dependency that is in the available packages
        for (const dep of deps) {
            if (availablePackages.has(dep)) {
                return dep;
            }
        }

        return undefined;
    }

    /**
     * Build a hierarchical structure of packages based on dependencies
     * Returns a map of parent package -> array of child packages
     */
    buildPackageHierarchy(packages: Set<string>): Map<string, string[]> {
        const hierarchy = new Map<string, string[]>();
        const roots = new Set<string>(packages);

        this.log(
            `Building package hierarchy from: ${Array.from(packages).join(", ")}`,
        );
        this.log(
            `Available dependencies: ${Array.from(this.packageDependencies.keys()).join(", ")}`,
        );

        // Build parent -> children map
        for (const pkg of packages) {
            const parent = this.getPackageParent(pkg, packages);
            this.log(`  ${pkg} -> parent: ${parent || "none"}`);
            if (parent) {
                if (!hierarchy.has(parent)) {
                    hierarchy.set(parent, []);
                }
                hierarchy.get(parent)!.push(pkg);
                roots.delete(pkg); // Remove from roots as it has a parent
            }
        }

        // Add root packages with empty children if not already present
        for (const root of roots) {
            if (!hierarchy.has(root)) {
                hierarchy.set(root, []);
            }
        }

        this.log(`Root packages: ${Array.from(roots).join(", ")}`);
        return hierarchy;
    }

    /**
     * Find inherited properties in examples by looking for properties with the same name
     */
    private findInheritedPropertiesInExamples(
        nodeName: string,
        propertyName: string,
    ): PropertyInfo[] {
        const inheritedProps: PropertyInfo[] = [];

        // Look for all properties with the same name in example files
        for (const [, node] of this.nodeCache) {
            if (
                node.name !== nodeName &&
                node.sourcePath.includes("examples/")
            ) {
                const prop = node.properties.get(propertyName);
                if (prop) {
                    // Include this as a potentially inherited property
                    inheritedProps.push(prop);
                }
            }
        }

        return inheritedProps;
    }

    /**
     * Recursively find subclasses
     */
    private findSubclassesRecursive(
        parentNode: NodeClass,
        propertyName: string,
        chain: NodeClass[],
        revisions: PropertyInfo[],
    ): void {
        for (const [, node] of this.nodeCache) {
            if (node.extends === parentNode.name) {
                const prop = node.properties.get(propertyName);
                if (prop) {
                    revisions.push(prop);
                }

                // Extension nodes (e.g. subNodeExtension4) are displayed via the
                // extensionCache / getNodeExtensions path in the hierarchy provider.
                // Do not add them to chain to avoid them appearing twice in the
                // tree. Their property revisions are still collected above so
                // properties that only exist in an extension are found correctly.
                if (node.type === "extension") {
                    continue;
                }

                chain.push(node);
                this.findSubclassesRecursive(
                    node,
                    propertyName,
                    chain,
                    revisions,
                );
            }
        }
    }
}
