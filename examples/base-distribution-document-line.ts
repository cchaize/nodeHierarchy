import type { Collection, decimal, Reference } from '@sage/xtrem-core';
import { date, decorators, NodeStatus, TextStream, useDefaultValue } from '@sage/xtrem-core';
import * as xtremLandedCost from '@sage/xtrem-landed-cost';
import * as xtremMasterData from '@sage/xtrem-master-data';
import * as xtremTax from '@sage/xtrem-tax';
import * as xtremDistribution from '..';

@decorators.subNode<BaseDistributionDocumentLine>({
    isAbstract: true,
    isPublished: true,
    extends: () => xtremMasterData.nodes.BaseDocumentItemLine,
    async saveBegin() {
        if (![NodeStatus.added, NodeStatus.modified].includes(this.$.status)) {
            return;
        }
        // Clean up empty AdditionalPriceDetail on line creation or line being updated only to avoid updates on existing documents
        // that do not accept modification anymore
        if ((await (await this.additionalPriceDetail)?.discountCharges.length) === 0) {
            await this.$.set({ additionalPriceDetail: null });
        }
    },
    async controlBegin(cx) {
        if (!(await this.$.context.isServiceOptionEnabled(xtremMasterData.serviceOptions.salesSaveAsDraft))) {
            await xtremDistribution.events.DistributionDocumentLine.checkCanHaveLandedCostLine(cx, this);
            await xtremDistribution.events.DistributionDocumentLine.checkCanHaveLandedCost(cx, this);
        }
    },
})
export class BaseDistributionDocumentLine extends xtremMasterData.nodes.BaseDocumentItemLine {
    @decorators.referencePropertyOverride<BaseDistributionDocumentLine, 'document'>({
        node: () => xtremDistribution.nodes.BaseDistributionDocument,
    })
    override readonly document: Reference<xtremDistribution.nodes.BaseDistributionDocument>;

    @decorators.referenceProperty<BaseDistributionDocumentLine, 'currency'>({
        isPublished: true,
        lookupAccess: true,
        node: () => xtremMasterData.nodes.Currency,
        dependsOn: [{ document: ['currency'] }],
        async getValue() {
            return (await this.document).currency;
        },
    })
    readonly currency: Reference<xtremMasterData.nodes.Currency>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'grossPrice'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        isNullable: true,
        dataType: () => xtremMasterData.dataTypes.basePrice,
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
    })
    readonly grossPrice: Promise<decimal | null>;

    @decorators.booleanProperty<BaseDistributionDocumentLine, 'canHaveAdditionalPriceDetail'>({
        getValue: () => false,
    })
    readonly canHaveAdditionalPriceDetail: Promise<boolean>;

    @decorators.referenceProperty<BaseDistributionDocumentLine, 'additionalPriceDetail'>({
        isPublished: true,
        isNullable: true,
        isVital: true,
        reverseReference: 'documentLine',
        node: () => xtremDistribution.nodes.AdditionalPriceDetail,
        lookupAccess: true,
        dependsOn: ['grossPrice'],
        async defaultValue() {
            return (await this.canHaveAdditionalPriceDetail) ? {} : null;
        },
        async control(cx) {
            await xtremDistribution.events.DistributionDocumentLine.checkCanHaveAdditionalPriceDetail(cx, this);
        },
    })
    readonly additionalPriceDetail: Reference<xtremDistribution.nodes.AdditionalPriceDetail | null>;

    /**
     * @deprecated use now this.additionalPriceDetail.discountCharges collection to read/save values
     */
    @decorators.collectionProperty<BaseDistributionDocumentLine, 'discountCharges'>({
        isPublished: true,
        lookupAccess: true,
        node: () => xtremDistribution.nodes.DocumentLineDiscountCharge,
        dependsOn: ['additionalPriceDetail'],
        async getFilter() {
            return { additionalPriceDetail: await this.additionalPriceDetail };
        },
    })
    readonly discountCharges: Collection<xtremDistribution.nodes.DocumentLineDiscountCharge>;

    @decorators.enumProperty<BaseDistributionDocumentLine, 'priceOrigin'>({
        isStored: true,
        isPublished: true,
        isNullable: true,
        lookupAccess: true,
        dataType: () => xtremDistribution.enums.basePriceOriginDataType,
    })
    readonly priceOrigin: Promise<xtremDistribution.enums.BasePriceOrigin | null>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'netPrice'>({
        isStoredOutput: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.basePrice,
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        lookupAccess: true,
        dependsOn: [
            'grossPrice',
            'quantity',
            'additionalPriceDetail',
            { additionalPriceDetail: ['discountCharges'] },
            'currency',
        ],
        async defaultValue() {
            if (await this.canHaveAdditionalPriceDetail) {
                return xtremDistribution.functions.calculateNetPrice(
                    (await this.grossPrice) ?? 0,
                    await this.quantity,
                    await xtremMasterData.dataTypes.basePrice.nodeScale(this),
                    (await this.additionalPriceDetail)?.discountCharges,
                );
            }

            return 0;
        },
        updatedValue: useDefaultValue,
        duplicatedValue: useDefaultValue,
    })
    readonly netPrice: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'signedQuantity'>({
        isPublished: true,
        dependsOn: ['quantity'],
        dataType: () => xtremMasterData.dataTypes.quantityInUnit,
        getValue() {
            return this.quantity;
        },
    })
    readonly signedQuantity: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'amountExcludingTax'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        dependsOn: ['quantity', 'netPrice'],
        async defaultValue() {
            return (await this.quantity) * (await this.netPrice);
        },
        updatedValue: useDefaultValue,
    })
    readonly amountExcludingTax: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'taxableAmount'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['document'],
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        defaultValue: 0,
        duplicatedValue: useDefaultValue,
    })
    readonly taxableAmount: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'taxAmount'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['document'],
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        defaultValue: 0,
        duplicatedValue: useDefaultValue,
    })
    readonly taxAmount: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'exemptAmount'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['document'],
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        defaultValue: 0,
        duplicatedValue: useDefaultValue,
    })
    readonly exemptAmount: Promise<decimal>;

    @decorators.dateProperty<BaseDistributionDocumentLine, 'taxDate'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
    })
    readonly taxDate: Promise<date>;

    @decorators.textStreamProperty<BaseDistributionDocumentLine, 'text'>({
        isStored: true,
        isPublished: true,
        dependsOn: ['item'],
        // TODO: add defaultValue with purchaseDocumentText property on item; then => this.item ? this.item.purchaseDocumentText;
        dataSensitivityLevel: 'personal',
        anonymizeMethod: 'fixed',
        anonymizeValue: TextStream.fromString('*'.repeat(15)),
    })
    readonly text: Promise<TextStream>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'signedAmountExcludingTax'>({
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['amountExcludingTax'],
        getValue() {
            return this.amountExcludingTax;
        },
    })
    readonly signedAmountExcludingTax: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'amountExcludingTaxInCompanyCurrency'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        lookupAccess: true,
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        dependsOn: [
            'amountExcludingTax',
            { document: ['companyCurrency', 'currency', 'companyFxRateDivisor', 'companyFxRate'] },
        ],
        async defaultValue() {
            return this.convertAmountInCompanyCurrency(await this.amountExcludingTax);
        },
        updatedValue: useDefaultValue,
    })
    readonly amountExcludingTaxInCompanyCurrency: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'signedAmountExcludingTaxInCompanyCurrency'>({
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['amountExcludingTaxInCompanyCurrency'],
        getValue() {
            return this.amountExcludingTaxInCompanyCurrency;
        },
    })
    readonly signedAmountExcludingTaxInCompanyCurrency: Promise<decimal>;

    @decorators.booleanProperty<BaseDistributionDocumentLine, 'canHaveLandedCost'>({
        isPublished: true,
        lookupAccess: true,
        serviceOptions: () => [xtremMasterData.serviceOptions.landedCostOption],
        getValue: () => false,
    })
    readonly canHaveLandedCost: Promise<boolean>;

    @decorators.referenceProperty<BaseDistributionDocumentLine, 'landedCost'>({
        isPublished: true,
        isNullable: true,
        isVital: true,
        reverseReference: 'documentLine',
        dependsOn: ['item'], // , 'amountExcludingTax', { taxes: ['taxAmountAdjusted', 'deductibleTaxAmount'] }], =>// This should be enhanced when BaseDistributionDocumentLine will be refactored with taxes included
        node: () => xtremLandedCost.nodes.LandedCostDocumentLine,
        lookupAccess: true,
        async defaultValue() {
            if ((await (await this.item).type) !== 'landedCost') {
                return null;
            }
            return {};
        },
    })
    readonly landedCost: Reference<xtremLandedCost.nodes.LandedCostDocumentLine | null>;

    @decorators.booleanProperty<BaseDistributionDocumentLine, 'canHaveLandedCostLine'>({
        isPublished: true,
        lookupAccess: true,
        serviceOptions: () => [xtremMasterData.serviceOptions.landedCostOption],
        getValue: () => false,
    })
    readonly canHaveLandedCostLine: Promise<boolean>;

    @decorators.collectionProperty<BaseDistributionDocumentLine, 'landedCostLines'>({
        isPublished: true,
        isVital: true,
        reverseReference: 'documentLine',
        node: () => xtremLandedCost.nodes.LandedCostLine,
    })
    readonly landedCostLines: Collection<xtremLandedCost.nodes.LandedCostLine>;

    @decorators.collectionProperty<BaseDistributionDocumentLine, 'taxes'>({
        isVital: true,
        isPublished: true,
        reverseReference: 'line',
        dependsOn: [{ document: ['status'] }],
        lookupAccess: true,
        node: () => xtremTax.nodes.DocumentLineTax,
        async isFrozen() {
            return (await (await this.document).status) === 'closed';
        },
        duplicatedValue: [],
    })
    readonly taxes: Collection<xtremTax.nodes.DocumentLineTax>;

    @decorators.enumProperty<BaseDistributionDocumentLine, 'taxCalculationStatus'>({
        isPublished: true,
        dataType: () => xtremMasterData.enums.taxCalculationStatusDataType,
        dependsOn: ['taxes'],
        async getValue() {
            if (await this.taxes.some(async tax => (await tax.isTaxMandatory) && (await tax.taxReference) == null)) {
                return 'failed';
            }
            if ((await this.taxes.length) === 0) {
                return 'notDone';
            }
            return 'done';
        },
    })
    readonly taxCalculationStatus: Promise<xtremMasterData.enums.TaxCalculationStatus>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'amountIncludingTax'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['amountExcludingTax', 'taxAmountAdjusted'],
        async defaultValue() {
            return (await this.amountExcludingTax) + (await this.taxAmountAdjusted);
        },
        updatedValue: useDefaultValue,
    })
    readonly amountIncludingTax: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'amountIncludingTaxInCompanyCurrency'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        dependsOn: ['amountIncludingTax', { document: ['site', 'currency', 'companyFxRateDivisor', 'companyFxRate'] }],
        async defaultValue() {
            return this.convertAmountInCompanyCurrency(await this.amountIncludingTax);
        },
        updatedValue: useDefaultValue,
    })
    readonly amountIncludingTaxInCompanyCurrency: Promise<decimal>;

    @decorators.decimalProperty<BaseDistributionDocumentLine, 'taxAmountAdjusted'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.dataTypes.amountDataType,
        dependsOn: ['document'],
        async control(cx, val) {
            await cx.error.if(val).is.negative();
        },
        defaultValue: 0,
        duplicatedValue: useDefaultValue,
    })
    readonly taxAmountAdjusted: Promise<decimal>;

    /** depends on companyFxRate - companyFxRateDivisor - currency - companyCurrency */
    async convertAmountInCompanyCurrency(amount: decimal) {
        return (await this.document).convertAmountInCompanyCurrency(amount);
    }

    getLandedCostAmountToAllocate(): Promise<decimal> {
        return xtremDistribution.functions.getLandedCostAmountToAllocate(this);
    }
}
