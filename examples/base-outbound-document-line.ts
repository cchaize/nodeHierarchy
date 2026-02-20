import type { decimal, Reference } from '@sage/xtrem-core';
import { decorators, useDefaultValue } from '@sage/xtrem-core';
import * as xtremMasterData from '@sage/xtrem-master-data';
import * as xtremDistribution from '..';
import { BaseDistributionDocumentLine } from './base-distribution-document-line';

@decorators.subNode<BaseOutboundDocumentLine>({
    isAbstract: true,
    isPublished: true,
    extends: () => BaseDistributionDocumentLine,
})
export class BaseOutboundDocumentLine extends BaseDistributionDocumentLine {
    @decorators.referencePropertyOverride<BaseOutboundDocumentLine, 'document'>({
        node: () => xtremDistribution.nodes.BaseOutboundDocument,
    })
    override readonly document: Reference<xtremDistribution.nodes.BaseOutboundDocument>;

    @decorators.referenceProperty<BaseOutboundDocumentLine, 'itemCustomer'>({
        isPublished: true,
        dependsOn: ['item', { document: ['customer'] }],
        node: () => xtremMasterData.nodes.ItemCustomer,
        isNullable: true,
        join: {
            item: 'item',
            async customer() {
                return (await this.document).customer;
            },
        },
    })
    readonly itemCustomer: Reference<xtremMasterData.nodes.ItemCustomer | null>;

    @decorators.referencePropertyOverride<BaseOutboundDocumentLine, 'unit'>({
        dependsOn: ['item'],
        async defaultValue() {
            const itemCustomer = await this.itemCustomer;
            if (itemCustomer && (await itemCustomer.isActive)) {
                return itemCustomer.salesUnit;
            }
            const item = await this.item;
            return (await item?.salesUnit) ?? item.stockUnit;
        },
    })
    override readonly unit: Reference<xtremMasterData.nodes.UnitOfMeasure>;

    @decorators.decimalPropertyOverride<BaseOutboundDocumentLine, 'unitToStockUnitConversionFactor'>({
        async control(cx, val) {
            await cx.error.if(val).is.negative();
            await cx.error.if(val).is.zero();
        },
        defaultValue: 1,
        updatedValue: useDefaultValue,
    })
    override readonly unitToStockUnitConversionFactor: Promise<decimal>;
}
