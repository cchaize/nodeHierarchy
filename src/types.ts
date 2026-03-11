/**
 * Represents a property in a Xtrem node with its decorator information
 */
export interface PropertyInfo {
    name: string;
    decoratorType: string; // e.g., 'property', 'referenceProperty', 'compositeProperty'
    decoratorParams: Record<string, unknown>;
    declaredIn: string; // class name where originally declared
    sourcePath: string; // file path
    lineNumber: number;
    revisedIn?: NodeRevision[]; // if overridden in child classes
}

/**
 * Represents a revision of a property in a child class
 */
export interface NodeRevision {
    className: string;
    decoratorType: string;
    decoratorParams: Record<string, unknown>;
    sourcePath: string;
    lineNumber: number;
}

/**
 * Represents a Xtrem node class
 */
export interface NodeClass {
    name: string;
    type: "node" | "subNode" | "extension";
    sourcePath: string;
    lineNumber: number;
    packageName?: string; // extracted from path (e.g., 'xtrem-master-data')
    extends?: string; // parent class name
    properties: Map<string, PropertyInfo>;
}

/**
 * Represents a search result showing the hierarchy chain
 */
export interface HierarchyChain {
    property: PropertyInfo;
    chain: NodeClass[]; // from root to current node
    revisions: NodeRevision[]; // all revisions of this property
}
