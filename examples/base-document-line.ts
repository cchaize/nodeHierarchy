import type { integer, Reference } from '@sage/xtrem-core';
import { decorators, Node } from '@sage/xtrem-core';
import * as xtremSystem from '@sage/xtrem-system';
import type * as xtremMasterData from '..';

@decorators.node<BaseDocumentLine>({
    isClearedByReset: true,
    storage: 'sql',
    isPublished: true,
    isAbstract: true,
    isCustomizable: true,
})
export class BaseDocumentLine extends Node {
    readonly document: Reference<xtremMasterData.interfaces.Document>;

    @decorators.stringProperty<BaseDocumentLine, 'documentNumber'>({
        isPublished: true,
        dataType: () => xtremSystem.dataTypes.code,
        // eslint-disable-next-line @sage/xtrem/property-decorators-errors
        async computeValue() {
            return (await this.document).number;
        },
        lookupAccess: true,
    })
    readonly documentNumber: Promise<string>;

    @decorators.integerProperty<BaseDocumentLine, 'documentId'>({
        isPublished: true,
        // eslint-disable-next-line @sage/xtrem/property-decorators-errors
        async computeValue() {
            return (await this.document)._id;
        },
        lookupAccess: true,
    })
    readonly documentId: Promise<integer>;
}
