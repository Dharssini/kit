/**
 * Returns a traditional stroopwafel
 * @example
 * traditional()
 */
export declare function traditional(): string;

/**
 * Returns a flavoured stroopwafel
 * @example
 * custom('falafel')
 */
export declare function oneFlavour(flavour: string): string;

/**
 * Returns a many flavoured stroopwafel
 * @example
 * custom(['strawberry', 'cream'])
 */
export declare function manyFlavours(flavours: string[]): string;

// Note that this is mocked by the helper project setup
export { fn } from '@openfn/language-common';
