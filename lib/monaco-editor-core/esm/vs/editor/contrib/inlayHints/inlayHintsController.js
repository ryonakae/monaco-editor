/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { distinct } from '../../../base/common/arrays';
import { RunOnceScheduler } from '../../../base/common/async';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation';
import { onUnexpectedExternalError } from '../../../base/common/errors';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle';
import { parseLinkedText } from '../../../base/common/linkedText';
import { LRUCache, ResourceMap } from '../../../base/common/map';
import { assertType } from '../../../base/common/types';
import { URI } from '../../../base/common/uri';
import { DynamicCssRules } from '../../browser/editorDom';
import { registerEditorContribution } from '../../browser/editorExtensions';
import { EDITOR_FONT_DEFAULTS } from '../../common/config/editorOptions';
import { Position } from '../../common/core/position';
import { Range } from '../../common/core/range';
import { InlayHintKind, InlayHintsProviderRegistry } from '../../common/languages';
import { LanguageFeatureRequestDelays } from '../../common/languages/languageFeatureRegistry';
import { ModelDecorationInjectedTextOptions } from '../../common/model/textModel';
import { ITextModelService } from '../../common/services/resolverService';
import { ClickLinkGesture } from '../gotoSymbol/link/clickLinkGesture';
import { CommandsRegistry } from '../../../platform/commands/common/commands';
import { IOpenerService } from '../../../platform/opener/common/opener';
import * as colors from '../../../platform/theme/common/colorRegistry';
import { themeColorFromId } from '../../../platform/theme/common/themeService';
const MAX_DECORATORS = 1500;
class RequestMap {
    constructor() {
        this._data = new ResourceMap();
    }
    push(model, provider) {
        const value = this._data.get(model.uri);
        if (value === undefined) {
            this._data.set(model.uri, new Set([provider]));
        }
        else {
            value.add(provider);
        }
    }
    pop(model, provider) {
        const value = this._data.get(model.uri);
        if (value) {
            value.delete(provider);
            if (value.size === 0) {
                this._data.delete(model.uri);
            }
        }
    }
    has(model, provider) {
        var _a;
        return Boolean((_a = this._data.get(model.uri)) === null || _a === void 0 ? void 0 : _a.has(provider));
    }
}
export function getInlayHints(model, ranges, requests, token) {
    return __awaiter(this, void 0, void 0, function* () {
        const all = [];
        const providers = InlayHintsProviderRegistry.ordered(model).reverse();
        const promises = providers.map(provider => ranges.map((range) => __awaiter(this, void 0, void 0, function* () {
            try {
                requests.push(model, provider);
                const result = yield provider.provideInlayHints(model, range, token);
                if (result === null || result === void 0 ? void 0 : result.length) {
                    all.push(result.filter(hint => range.containsPosition(hint.position)));
                }
            }
            catch (err) {
                onUnexpectedExternalError(err);
            }
            finally {
                requests.pop(model, provider);
            }
        })));
        yield Promise.all(promises.flat());
        return all.flat().sort((a, b) => Position.compare(a.position, b.position));
    });
}
class InlayHintsCache {
    constructor() {
        this._entries = new LRUCache(50);
    }
    get(model) {
        const key = InlayHintsCache._key(model);
        return this._entries.get(key);
    }
    set(model, value) {
        const key = InlayHintsCache._key(model);
        this._entries.set(key, value);
    }
    static _key(model) {
        return `${model.uri.toString()}/${model.getVersionId()}`;
    }
}
class InlayHintLink {
    constructor(href, index, hint) {
        this.href = href;
        this.index = index;
        this.hint = hint;
    }
}
let InlayHintsController = class InlayHintsController {
    constructor(_editor, _openerService) {
        this._editor = _editor;
        this._openerService = _openerService;
        this._decorationOwnerId = ++InlayHintsController._decorationOwnerIdPool;
        this._disposables = new DisposableStore();
        this._sessionDisposables = new DisposableStore();
        this._getInlayHintsDelays = new LanguageFeatureRequestDelays(InlayHintsProviderRegistry, 25, 500);
        this._cache = new InlayHintsCache();
        this._decorationsMetadata = new Map();
        this._ruleFactory = new DynamicCssRules(this._editor);
        this._disposables.add(InlayHintsProviderRegistry.onDidChange(() => this._update()));
        this._disposables.add(_editor.onDidChangeModel(() => this._update()));
        this._disposables.add(_editor.onDidChangeModelLanguage(() => this._update()));
        this._disposables.add(_editor.onDidChangeConfiguration(e => {
            if (e.hasChanged(126 /* inlayHints */)) {
                this._update();
            }
        }));
        this._update();
    }
    dispose() {
        this._sessionDisposables.dispose();
        this._removeAllDecorations();
        this._disposables.dispose();
    }
    _update() {
        this._sessionDisposables.clear();
        this._removeAllDecorations();
        if (!this._editor.getOption(126 /* inlayHints */).enabled) {
            return;
        }
        const model = this._editor.getModel();
        if (!model || !InlayHintsProviderRegistry.has(model)) {
            return;
        }
        // iff possible, quickly update from cache
        const cached = this._cache.get(model);
        if (cached) {
            this._updateHintsDecorators([model.getFullModelRange()], cached);
        }
        const requests = new RequestMap();
        const scheduler = new RunOnceScheduler(() => __awaiter(this, void 0, void 0, function* () {
            const t1 = Date.now();
            const cts = new CancellationTokenSource();
            this._sessionDisposables.add(toDisposable(() => cts.dispose(true)));
            const ranges = this._getHintsRanges();
            const result = yield getInlayHints(model, ranges, requests, cts.token);
            scheduler.delay = this._getInlayHintsDelays.update(model, Date.now() - t1);
            if (cts.token.isCancellationRequested) {
                return;
            }
            this._updateHintsDecorators(ranges, result);
            this._cache.set(model, distinct(Array.from(this._decorationsMetadata.values(), obj => obj.hint)));
        }), this._getInlayHintsDelays.get(model));
        this._sessionDisposables.add(scheduler);
        // update inline hints when content or scroll position changes
        this._sessionDisposables.add(this._editor.onDidChangeModelContent(() => scheduler.schedule()));
        this._sessionDisposables.add(this._editor.onDidScrollChange(() => scheduler.schedule()));
        scheduler.schedule();
        // update inline hints when any any provider fires an event
        const providerListener = new DisposableStore();
        this._sessionDisposables.add(providerListener);
        for (const provider of InlayHintsProviderRegistry.all(model)) {
            if (typeof provider.onDidChangeInlayHints === 'function') {
                providerListener.add(provider.onDidChangeInlayHints(() => {
                    if (!requests.has(model, provider)) {
                        scheduler.schedule();
                    }
                }));
            }
        }
        // link gesture
        let undoHover = () => { };
        const gesture = this._sessionDisposables.add(new ClickLinkGesture(this._editor));
        this._sessionDisposables.add(gesture.onMouseMoveOrRelevantKeyDown(e => {
            var _a, _b;
            const [mouseEvent] = e;
            if (mouseEvent.target.type !== 6 /* CONTENT_TEXT */ || typeof mouseEvent.target.detail !== 'object' || !mouseEvent.hasTriggerModifier) {
                undoHover();
                return;
            }
            const model = this._editor.getModel();
            const options = (_b = (_a = mouseEvent.target.detail) === null || _a === void 0 ? void 0 : _a.injectedText) === null || _b === void 0 ? void 0 : _b.options;
            if (options instanceof ModelDecorationInjectedTextOptions && options.attachedData instanceof InlayHintLink) {
                this._activeInlayHintLink = options.attachedData;
                const lineNumber = this._activeInlayHintLink.hint.position.lineNumber;
                const range = new Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber));
                const lineHints = new Set();
                for (let data of this._decorationsMetadata.values()) {
                    if (range.containsPosition(data.hint.position)) {
                        lineHints.add(data.hint);
                    }
                }
                this._updateHintsDecorators([range], Array.from(lineHints));
                undoHover = () => {
                    this._activeInlayHintLink = undefined;
                    this._updateHintsDecorators([range], Array.from(lineHints));
                };
            }
        }));
        this._sessionDisposables.add(gesture.onCancel(undoHover));
        this._sessionDisposables.add(gesture.onExecute(e => {
            var _a, _b;
            if (e.target.type !== 6 /* CONTENT_TEXT */ || typeof e.target.detail !== 'object' || !e.hasTriggerModifier) {
                return;
            }
            const options = (_b = (_a = e.target.detail) === null || _a === void 0 ? void 0 : _a.injectedText) === null || _b === void 0 ? void 0 : _b.options;
            if (options instanceof ModelDecorationInjectedTextOptions && options.attachedData instanceof InlayHintLink) {
                this._openerService.open(options.attachedData.href, { allowCommands: true, openToSide: e.hasSideBySideModifier });
            }
        }));
    }
    _getHintsRanges() {
        const extra = 30;
        const model = this._editor.getModel();
        const visibleRanges = this._editor.getVisibleRangesPlusViewportAboveBelow();
        const result = [];
        for (const range of visibleRanges.sort(Range.compareRangesUsingStarts)) {
            const extendedRange = model.validateRange(new Range(range.startLineNumber - extra, range.startColumn, range.endLineNumber + extra, range.endColumn));
            if (result.length === 0 || !Range.areIntersectingOrTouching(result[result.length - 1], extendedRange)) {
                result.push(extendedRange);
            }
            else {
                result[result.length - 1] = Range.plusRange(result[result.length - 1], extendedRange);
            }
        }
        return result;
    }
    _updateHintsDecorators(ranges, hints) {
        var _a;
        const { fontSize, fontFamily } = this._getLayoutInfo();
        const model = this._editor.getModel();
        const newDecorationsData = [];
        const fontFamilyVar = '--code-editorInlayHintsFontFamily';
        this._editor.getContainerDomNode().style.setProperty(fontFamilyVar, fontFamily);
        for (const hint of hints) {
            const { position, whitespaceBefore, whitespaceAfter } = hint;
            // position
            let direction = 'before';
            let range = Range.fromPositions(position);
            let word = model.getWordAtPosition(position);
            let usesWordRange = false;
            if (word) {
                if (word.endColumn === position.column) {
                    direction = 'after';
                    usesWordRange = true;
                    range = wordToRange(word, position.lineNumber);
                }
                else if (word.startColumn === position.column) {
                    usesWordRange = true;
                    range = wordToRange(word, position.lineNumber);
                }
            }
            // text w/ links
            const { nodes } = parseLinkedText(hint.text);
            const marginBefore = whitespaceBefore ? (fontSize / 3) | 0 : 0;
            const marginAfter = whitespaceAfter ? (fontSize / 3) | 0 : 0;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const isFirst = i === 0;
                const isLast = i === nodes.length - 1;
                const isLink = typeof node === 'object';
                const cssProperties = {
                    fontSize: `${fontSize}px`,
                    fontFamily: `var(${fontFamilyVar}), ${EDITOR_FONT_DEFAULTS.fontFamily}`,
                    verticalAlign: 'middle',
                };
                this._fillInColors(cssProperties, hint);
                if (isLink) {
                    cssProperties.textDecoration = 'underline';
                    if (((_a = this._activeInlayHintLink) === null || _a === void 0 ? void 0 : _a.hint) === hint && this._activeInlayHintLink.index === i && this._activeInlayHintLink.href === node.href) {
                        // active link!
                        cssProperties.cursor = 'pointer';
                        cssProperties.color = themeColorFromId(colors.editorActiveLinkForeground);
                    }
                }
                if (isFirst && isLast) {
                    // only element
                    cssProperties.margin = `0px ${marginAfter}px 0px ${marginBefore}px`;
                    cssProperties.padding = `1px ${Math.max(1, fontSize / 4) | 0}px`;
                    cssProperties.borderRadius = `${(fontSize / 4) | 0}px`;
                }
                else if (isFirst) {
                    // first element
                    cssProperties.margin = `0px 0 0 ${marginAfter}px`;
                    cssProperties.padding = `1px 0 0 ${Math.max(1, fontSize / 4) | 0}px`;
                    cssProperties.borderRadius = `${(fontSize / 4) | 0}px 0 0 ${(fontSize / 4) | 0}px`;
                }
                else if (isLast) {
                    // last element
                    cssProperties.margin = `0px ${marginAfter}px 0 0`;
                    cssProperties.padding = `1px ${Math.max(1, fontSize / 4) | 0}px 0 0`;
                    cssProperties.borderRadius = `0 ${(fontSize / 4) | 0}px ${(fontSize / 4) | 0}px 0`;
                }
                else {
                    cssProperties.padding = `1px 0 1px 0`;
                }
                const classNameRef = this._ruleFactory.createClassNameRef(cssProperties);
                newDecorationsData.push({
                    hint,
                    classNameRef,
                    decoration: {
                        range,
                        options: {
                            [direction]: {
                                content: fixSpace(isLink ? node.label : node),
                                inlineClassNameAffectsLetterSpacing: true,
                                inlineClassName: classNameRef.className,
                                attachedData: isLink ? new InlayHintLink(node.href, i, hint) : undefined
                            },
                            description: 'InlayHint',
                            showIfCollapsed: !usesWordRange,
                            stickiness: 0 /* AlwaysGrowsWhenTypingAtEdges */
                        }
                    },
                });
            }
            if (newDecorationsData.length > MAX_DECORATORS) {
                break;
            }
        }
        // collect all decoration ids that are affected by the ranges
        // and only update those decorations
        const decorationIdsToReplace = [];
        for (const range of ranges) {
            for (const { id } of model.getDecorationsInRange(range, this._decorationOwnerId, true)) {
                const metadata = this._decorationsMetadata.get(id);
                if (metadata) {
                    decorationIdsToReplace.push(id);
                    metadata.classNameRef.dispose();
                    this._decorationsMetadata.delete(id);
                }
            }
        }
        const newDecorationIds = model.deltaDecorations(decorationIdsToReplace, newDecorationsData.map(d => d.decoration), this._decorationOwnerId);
        for (let i = 0; i < newDecorationIds.length; i++) {
            const data = newDecorationsData[i];
            this._decorationsMetadata.set(newDecorationIds[i], { hint: data.hint, classNameRef: data.classNameRef });
        }
    }
    _fillInColors(props, hint) {
        if (hint.kind === InlayHintKind.Parameter) {
            props.backgroundColor = themeColorFromId(colors.editorInlayHintParameterBackground);
            props.color = themeColorFromId(colors.editorInlayHintParameterForeground);
        }
        else if (hint.kind === InlayHintKind.Type) {
            props.backgroundColor = themeColorFromId(colors.editorInlayHintTypeBackground);
            props.color = themeColorFromId(colors.editorInlayHintTypeForeground);
        }
        else {
            props.backgroundColor = themeColorFromId(colors.editorInlayHintBackground);
            props.color = themeColorFromId(colors.editorInlayHintForeground);
        }
    }
    _getLayoutInfo() {
        const options = this._editor.getOption(126 /* inlayHints */);
        const editorFontSize = this._editor.getOption(45 /* fontSize */);
        let fontSize = options.fontSize;
        if (!fontSize || fontSize < 5 || fontSize > editorFontSize) {
            fontSize = (editorFontSize * .9) | 0;
        }
        const fontFamily = options.fontFamily || this._editor.getOption(42 /* fontFamily */);
        return { fontSize, fontFamily };
    }
    _removeAllDecorations() {
        this._editor.deltaDecorations(Array.from(this._decorationsMetadata.keys()), []);
        for (let obj of this._decorationsMetadata.values()) {
            obj.classNameRef.dispose();
        }
        this._decorationsMetadata.clear();
    }
};
InlayHintsController.ID = 'editor.contrib.InlayHints';
InlayHintsController._decorationOwnerIdPool = 0;
InlayHintsController = __decorate([
    __param(1, IOpenerService)
], InlayHintsController);
export { InlayHintsController };
function wordToRange(word, lineNumber) {
    return new Range(lineNumber, word.startColumn, lineNumber, word.endColumn);
}
// Prevents the view from potentially visible whitespace
function fixSpace(str) {
    const noBreakWhitespace = '\xa0';
    return str.replace(/[ \t]/g, noBreakWhitespace);
}
registerEditorContribution(InlayHintsController.ID, InlayHintsController);
CommandsRegistry.registerCommand('_executeInlayHintProvider', (accessor, ...args) => __awaiter(void 0, void 0, void 0, function* () {
    const [uri, range] = args;
    assertType(URI.isUri(uri));
    assertType(Range.isIRange(range));
    const ref = yield accessor.get(ITextModelService).createModelReference(uri);
    try {
        const data = yield getInlayHints(ref.object.textEditorModel, [Range.lift(range)], new RequestMap(), CancellationToken.None);
        return data;
    }
    finally {
        ref.dispose();
    }
}));
