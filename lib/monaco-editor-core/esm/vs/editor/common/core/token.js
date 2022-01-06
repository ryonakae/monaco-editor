/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export class Token {
    constructor(offset, type, language) {
        this._tokenBrand = undefined;
        this.offset = offset;
        this.type = type;
        this.language = language;
    }
    toString() {
        return '(' + this.offset + ', ' + this.type + ')';
    }
}
export class TokenizationResult {
    constructor(tokens, endState) {
        this._tokenizationResultBrand = undefined;
        this.tokens = tokens;
        this.endState = endState;
    }
}
export class EncodedTokenizationResult {
    constructor(tokens, endState) {
        this._encodedTokenizationResultBrand = undefined;
        this.tokens = tokens;
        this.endState = endState;
    }
}
