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
import * as dom from '../../../base/browser/dom';
import { MarkdownString } from '../../../base/common/htmlContent';
import { DisposableStore } from '../../../base/common/lifecycle';
import { MarkdownRenderer } from '../../browser/core/markdownRenderer';
import { Range } from '../../common/core/range';
import { ILanguageService } from '../../common/services/language';
import { HoverForeignElementAnchor } from '../hover/hoverTypes';
import { commitInlineSuggestionAction, GhostTextController, ShowNextInlineSuggestionAction, ShowPreviousInlineSuggestionAction } from './ghostTextController';
import * as nls from '../../../nls';
import { IAccessibilityService } from '../../../platform/accessibility/common/accessibility';
import { IMenuService, MenuId, MenuItemAction } from '../../../platform/actions/common/actions';
import { ICommandService } from '../../../platform/commands/common/commands';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey';
import { IOpenerService } from '../../../platform/opener/common/opener';
export class InlineCompletionsHover {
    constructor(owner, range, controller) {
        this.owner = owner;
        this.range = range;
        this.controller = controller;
    }
    isValidForHoverAnchor(anchor) {
        return (anchor.type === 1 /* Range */
            && this.range.startColumn <= anchor.range.startColumn
            && this.range.endColumn >= anchor.range.endColumn);
    }
    hasMultipleSuggestions() {
        return this.controller.hasMultipleInlineCompletions();
    }
}
let InlineCompletionsHoverParticipant = class InlineCompletionsHoverParticipant {
    constructor(_editor, _hover, _commandService, _menuService, _contextKeyService, _languageService, _openerService, accessibilityService) {
        this._editor = _editor;
        this._hover = _hover;
        this._commandService = _commandService;
        this._menuService = _menuService;
        this._contextKeyService = _contextKeyService;
        this._languageService = _languageService;
        this._openerService = _openerService;
        this.accessibilityService = accessibilityService;
    }
    suggestHoverAnchor(mouseEvent) {
        const controller = GhostTextController.get(this._editor);
        if (!controller) {
            return null;
        }
        if (mouseEvent.target.type === 8 /* CONTENT_VIEW_ZONE */) {
            // handle the case where the mouse is over the view zone
            const viewZoneData = mouseEvent.target.detail;
            if (controller.shouldShowHoverAtViewZone(viewZoneData.viewZoneId)) {
                return new HoverForeignElementAnchor(1000, this, Range.fromPositions(viewZoneData.positionBefore || viewZoneData.position, viewZoneData.positionBefore || viewZoneData.position));
            }
        }
        if (mouseEvent.target.type === 7 /* CONTENT_EMPTY */ && mouseEvent.target.range) {
            // handle the case where the mouse is over the empty portion of a line following ghost text
            if (controller.shouldShowHoverAt(mouseEvent.target.range)) {
                return new HoverForeignElementAnchor(1000, this, mouseEvent.target.range);
            }
        }
        if (mouseEvent.target.type === 6 /* CONTENT_TEXT */ && mouseEvent.target.range && mouseEvent.target.detail) {
            // handle the case where the mouse is directly over ghost text
            const mightBeForeignElement = mouseEvent.target.detail.mightBeForeignElement;
            if (mightBeForeignElement && controller.shouldShowHoverAt(mouseEvent.target.range)) {
                return new HoverForeignElementAnchor(1000, this, mouseEvent.target.range);
            }
        }
        return null;
    }
    computeSync(anchor, lineDecorations) {
        const controller = GhostTextController.get(this._editor);
        if (controller && controller.shouldShowHoverAt(anchor.range)) {
            return [new InlineCompletionsHover(this, anchor.range, controller)];
        }
        return [];
    }
    renderHoverParts(hoverParts, fragment, statusBar) {
        const disposableStore = new DisposableStore();
        const part = hoverParts[0];
        if (this.accessibilityService.isScreenReaderOptimized()) {
            this.renderScreenReaderText(part, fragment, disposableStore);
        }
        const menu = disposableStore.add(this._menuService.createMenu(MenuId.InlineCompletionsActions, this._contextKeyService));
        const previousAction = statusBar.addAction({
            label: nls.localize('showNextInlineSuggestion', "Next"),
            commandId: ShowNextInlineSuggestionAction.ID,
            run: () => this._commandService.executeCommand(ShowNextInlineSuggestionAction.ID)
        });
        const nextAction = statusBar.addAction({
            label: nls.localize('showPreviousInlineSuggestion', "Previous"),
            commandId: ShowPreviousInlineSuggestionAction.ID,
            run: () => this._commandService.executeCommand(ShowPreviousInlineSuggestionAction.ID)
        });
        statusBar.addAction({
            label: nls.localize('acceptInlineSuggestion', "Accept"),
            commandId: commitInlineSuggestionAction.id,
            run: () => this._commandService.executeCommand(commitInlineSuggestionAction.id)
        });
        const actions = [previousAction, nextAction];
        for (const action of actions) {
            action.setEnabled(false);
        }
        part.hasMultipleSuggestions().then(hasMore => {
            for (const action of actions) {
                action.setEnabled(hasMore);
            }
        });
        for (const [_, group] of menu.getActions()) {
            for (const action of group) {
                if (action instanceof MenuItemAction) {
                    statusBar.addAction({
                        label: action.label,
                        commandId: action.item.id,
                        run: () => this._commandService.executeCommand(action.item.id)
                    });
                }
            }
        }
        return disposableStore;
    }
    renderScreenReaderText(part, fragment, disposableStore) {
        var _a, _b;
        const $ = dom.$;
        const markdownHoverElement = $('div.hover-row.markdown-hover');
        const hoverContentsElement = dom.append(markdownHoverElement, $('div.hover-contents'));
        const renderer = disposableStore.add(new MarkdownRenderer({ editor: this._editor }, this._languageService, this._openerService));
        const render = (code) => {
            disposableStore.add(renderer.onDidRenderAsync(() => {
                hoverContentsElement.className = 'hover-contents code-hover-contents';
                this._hover.onContentsChanged();
            }));
            const inlineSuggestionAvailable = nls.localize('inlineSuggestionFollows', "Suggestion:");
            const renderedContents = disposableStore.add(renderer.render(new MarkdownString().appendText(inlineSuggestionAvailable).appendCodeblock('text', code)));
            hoverContentsElement.replaceChildren(renderedContents.element);
        };
        const ghostText = (_b = (_a = part.controller.activeModel) === null || _a === void 0 ? void 0 : _a.inlineCompletionsModel) === null || _b === void 0 ? void 0 : _b.ghostText;
        if (ghostText) {
            const lineText = this._editor.getModel().getLineContent(ghostText.lineNumber);
            render(ghostText.renderForScreenReader(lineText));
        }
        fragment.appendChild(markdownHoverElement);
    }
};
InlineCompletionsHoverParticipant = __decorate([
    __param(2, ICommandService),
    __param(3, IMenuService),
    __param(4, IContextKeyService),
    __param(5, ILanguageService),
    __param(6, IOpenerService),
    __param(7, IAccessibilityService)
], InlineCompletionsHoverParticipant);
export { InlineCompletionsHoverParticipant };