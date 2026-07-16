// @ts-nocheck

import { FOCUS_RETURN_EVENT_TYPES, TEXT_LOG_DELAY_MS } from "./constants";
import { exactModifierMatch } from "./keyEvents";

const OWNER_ID = "__mzPlayerTextOverlayOwnerId";

export function createTextOverlayBridge({ config, postParentMessage, settings }) {
  const overlayState = {
    nextOwnerId: 1,
    bitmapOwners: new WeakMap(),
    contextOwners: new WeakMap(),
    entries: new Map(),
    lineGroups: new Map(),
    textLogTimers: new Map(),
    textLogValues: new Map(),
    consumedGuardKeyCodes: new Set(),
    hoveredTextEntry: null,
    raf: 0,
    lastScene: null,
    installedHooks: false,
    inputGuardInstalled: false,
    sceneHooksInstalled: false,
    sceneBaseHooksInstalled: false,
    focusReturnInstalled: false,
    canvasTextCaptureDepth: 0,
    root: null,
    style: null,
  };

  function ensureOverlayDom() {
    if (!overlayState.style) {
      overlayState.style = document.createElement("style");
      overlayState.style.textContent = `
        canvas:focus,
        canvas:focus-visible,
        video:focus,
        video:focus-visible {
          outline: none !important;
        }

        #mz-player-text-overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          display: none;
          font-synthesis: none;
          text-rendering: optimizeLegibility;
        }

        #mz-player-text-overlay.mz-player-text-overlay-active {
          display: block;
        }

        .mz-player-text-overlay-entry {
          position: fixed;
          box-sizing: border-box;
          display: block;
          white-space: pre;
          overflow: visible;
          pointer-events: none;
          user-select: text;
          contain: layout style paint;
          color: transparent;
          text-shadow: none;
          background: transparent;
          border-radius: 2px;
          padding: 0;
          margin: 0;
          border: 0;
          line-height: 1;
          letter-spacing: 0;
          word-spacing: 0;
          font-kerning: none;
          font-variant-ligatures: none;
          opacity: 1;
        }

        #mz-player-text-overlay.mz-player-text-overlay-readable .mz-player-text-overlay-entry {
          color: rgba(255, 255, 255, 0.96);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 3px rgba(0, 0, 0, 0.8);
          background: transparent;
        }

        #mz-player-text-overlay.mz-player-text-overlay-reader .mz-player-text-overlay-entry {
          pointer-events: auto;
          cursor: text;
        }
      `;
      document.documentElement.appendChild(overlayState.style);
    }

    if (!overlayState.root) {
      overlayState.root = document.createElement("div");
      overlayState.root.id = "mz-player-text-overlay";
      document.documentElement.appendChild(overlayState.root);
      installOverlayFocusReturn();
    }
  }

  function installOverlayFocusReturn() {
    if (!overlayState.root || overlayState.focusReturnInstalled) return;
    overlayState.focusReturnInstalled = true;

    const trackOverlayText = (event) => {
      const entry = overlayTextEntry(event.target);
      if (!entry) return;
      overlayState.hoveredTextEntry = entry;
    };

    const clearOverlayText = (event) => {
      if (!overlayState.hoveredTextEntry) return;
      if (event.relatedTarget instanceof Node && overlayState.root.contains(event.relatedTarget)) return;
      overlayState.hoveredTextEntry = null;
    };

    const consumeOverlayTextPointerEvent = (event) => {
      const entry = overlayTextEntry(event.target);
      if (!entry) return;
      overlayState.hoveredTextEntry = entry;
      event.stopPropagation();
    };

    const restoreGameFocusAfterSurfacePointer = (event) => {
      if (overlayTextEntry(event.target) || !eventTargetsGameSurface(event.target)) return;
      if (!FOCUS_RETURN_EVENT_TYPES.includes(event.type)) return;
      window.setTimeout(() => {
        focusGameTarget();
        returnFocus();
      }, 0);
    };

    const returnFocus = () => {
      if (!settings.readerMode) return;
      window.setTimeout(() => {
        postParentMessage({ type: "return-focus" });
      }, 0);
    };

    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend"]) {
      window.addEventListener(type, consumeOverlayTextPointerEvent, true);
      window.addEventListener(type, restoreGameFocusAfterSurfacePointer, true);
    }
    overlayState.root.addEventListener("pointerover", trackOverlayText, true);
    overlayState.root.addEventListener("pointermove", trackOverlayText, true);
    overlayState.root.addEventListener("pointerdown", trackOverlayText, true);
    overlayState.root.addEventListener("pointerup", returnFocus, true);
    overlayState.root.addEventListener("mouseup", returnFocus, true);
    overlayState.root.addEventListener("touchend", returnFocus, true);
    overlayState.root.addEventListener("click", returnFocus, true);
    overlayState.root.addEventListener("pointerout", clearOverlayText, true);

    for (const type of ["keydown", "keypress", "keyup"]) {
      window.addEventListener(type, handleDictionaryGuardKeyEvent, true);
    }
    window.addEventListener("blur", clearGuardState, true);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState !== "visible") clearGuardState();
      },
      true
    );
  }

  function overlayTextEntry(target) {
    return target instanceof Element ? target.closest(".mz-player-text-overlay-entry") : null;
  }

  function eventTargetsGameSurface(target) {
    if (target === document || target === document.body || target === document.documentElement) return true;
    return target instanceof Element && Boolean(target.closest("canvas, video"));
  }

  function dictionaryGuardActive() {
    return Boolean(settings.overlayEnabled && settings.dictionaryDismissGuard?.enabled && settings.dictionaryDismissGuard.triggers?.length);
  }

  function handleDictionaryGuardKeyEvent(event) {
    if (event.code === "Escape") {
      clearGuardState();
      return;
    }
    maybeConsumeDictionaryDismissKeyEvent(event);
  }

  function maybeConsumeDictionaryDismissKeyEvent(event) {
    if (event.type === "keyup" && overlayState.consumedGuardKeyCodes.has(event.code)) {
      overlayState.consumedGuardKeyCodes.delete(event.code);
      releaseRpgMakerInputState(event);
      consumeEvent(event);
      return true;
    }
    if (event.type === "keyup" && guardReleaseMatchesKeyEvent(event)) {
      overlayState.consumedGuardKeyCodes.delete(event.code);
      releaseRpgMakerInputState(event);
      consumeEvent(event);
      return true;
    }
    if (!dictionaryGuardActive()) return false;
    const match = settings.dictionaryDismissGuard.triggers.find((trigger) => guardTriggerMatchesKeyEvent(event, trigger));
    if (!match) return false;
    releaseRpgMakerInputState(event);
    consumeEvent(event);
    if (event.type === "keydown") {
      overlayState.consumedGuardKeyCodes.add(event.code);
    }
    if (event.type === "keyup") {
      overlayState.consumedGuardKeyCodes.delete(event.code);
    }
    return true;
  }

  function guardReleaseMatchesKeyEvent(event) {
    if (!settings.dictionaryDismissGuard?.enabled || !settings.dictionaryDismissGuard.triggers?.length) return false;
    return settings.dictionaryDismissGuard.triggers.some((trigger) => {
      if (trigger.code) return event.code === trigger.code;
      return modifierOnlyTriggerMatchesEventCode(event.code, trigger);
    });
  }

  function guardTriggerMatchesKeyEvent(event, trigger) {
    if (!exactModifierMatch(event, trigger)) return false;
    if (trigger.code) return event.code === trigger.code;
    return modifierOnlyTriggerMatchesEventCode(event.code, trigger);
  }

  function modifierOnlyTriggerMatchesEventCode(code, trigger) {
    return (
      (trigger.altKey && (code === "AltLeft" || code === "AltRight")) ||
      (trigger.ctrlKey && (code === "ControlLeft" || code === "ControlRight")) ||
      (trigger.metaKey && (code === "MetaLeft" || code === "MetaRight")) ||
      (trigger.shiftKey && (code === "ShiftLeft" || code === "ShiftRight"))
    );
  }

  function installDictionaryGuardInputHooks() {
    if (overlayState.inputGuardInstalled) return;

    const install = () => {
      if (overlayState.inputGuardInstalled) return true;
      const input = window.Input;
      if (!input || typeof input._onKeyDown !== "function" || typeof input._onKeyUp !== "function") return false;

      overlayState.inputGuardInstalled = true;
      const originalKeyDown = input._onKeyDown;
      const originalKeyUp = input._onKeyUp;

      input._onKeyDown = function (event) {
        if (dictionaryGuardInputShouldBlock(event)) {
          overlayState.consumedGuardKeyCodes.add(event.code);
          releaseRpgMakerInputState(event);
          consumeEvent(event);
          return;
        }
        return originalKeyDown.apply(this, arguments);
      };

      input._onKeyUp = function (event) {
        if (overlayState.consumedGuardKeyCodes.has(event.code) || dictionaryGuardInputShouldBlock(event)) {
          overlayState.consumedGuardKeyCodes.delete(event.code);
          releaseRpgMakerInputState(event);
          consumeEvent(event);
          return;
        }
        return originalKeyUp.apply(this, arguments);
      };

      return true;
    };

    if (install()) return;
    setTimeout(installDictionaryGuardInputHooks, 250);
  }

  function dictionaryGuardInputShouldBlock(event) {
    if (!dictionaryGuardActive()) return false;
    return settings.dictionaryDismissGuard.triggers.some((trigger) => guardTriggerMatchesKeyEvent(event, trigger));
  }

  function releaseRpgMakerInputState(event) {
    const input = window.Input;
    const keyName = input?.keyMapper?.[event.keyCode];
    if (!keyName || !input._currentState) return;
    input._currentState[keyName] = false;
    if (input._latestButton === keyName) input._latestButton = null;
  }

  function consumeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }

  function clearGuardState() {
    overlayState.consumedGuardKeyCodes.clear();
  }

  function focusGameTarget() {
    const graphics = window.Graphics || {};
    const canvas = graphics._canvas || document.querySelector("canvas");
    const target = canvas || document.body || document.documentElement;
    try {
      window.focus();
    } catch {
      // Some hosts ignore scripted frame focus.
    }
    focusElement(document.documentElement);
    focusElement(document.body);
    focusElement(target);
    if (canvas && canvas !== target) focusElement(canvas);
  }

  function focusElement(target) {
    if (!target || typeof target.focus !== "function") return;
    try {
      if (target instanceof HTMLElement && !target.hasAttribute("tabindex")) {
        target.tabIndex = -1;
      }
      if (target instanceof HTMLElement) {
        target.style.outline = "none";
      }
      target.focus({ preventScroll: true });
    } catch {
      try {
        target.focus();
      } catch {
        // Focus is best-effort; gameplay still works once the frame is active.
      }
    }
  }

  function refreshOverlayClasses() {
    ensureOverlayDom();
    const active = overlayIsActive();
    overlayState.root.classList.toggle("mz-player-text-overlay-active", active);
    overlayState.root.classList.toggle("mz-player-text-overlay-readable", settings.readableOverlay);
    overlayState.root.classList.toggle("mz-player-text-overlay-reader", settings.readerMode);
    if (!active) {
      clearOverlayEntries();
      clearGuardState();
    }
    scheduleFlush();
  }

  function overlayIsActive() {
    return settings.overlayEnabled || settings.readableOverlay || settings.readerMode;
  }

  function installRpgMakerOverlayHooks() {
    if (overlayState.installedHooks) return;

    const install = () => {
      if (overlayState.installedHooks) return true;
      if (!window.Bitmap || !window.Window_Base || !window.Window || !window.Graphics) return false;

      overlayState.installedHooks = true;
      installSceneHooks();
      installCanvasTextHooks();

      const bitmapDrawText = Bitmap.prototype.drawText;
      Bitmap.prototype.drawText = function (text, x, y, maxWidth, lineHeight, align) {
        overlayState.canvasTextCaptureDepth++;
        try {
          const result = bitmapDrawText.apply(this, arguments);
          captureBitmapText(this, text, x, y, maxWidth, lineHeight, align);
          return result;
        } finally {
          overlayState.canvasTextCaptureDepth--;
        }
      };

      const bitmapClear = Bitmap.prototype.clear;
      Bitmap.prototype.clear = function () {
        forgetBitmap(this);
        return bitmapClear.apply(this, arguments);
      };

      const bitmapClearRect = Bitmap.prototype.clearRect;
      Bitmap.prototype.clearRect = function (x, y, width, height) {
        forgetBitmapRect(this, x, y, width, height);
        return bitmapClearRect.apply(this, arguments);
      };

      const createContents = Window_Base.prototype.createContents;
      Window_Base.prototype.createContents = function () {
        const result = createContents.apply(this, arguments);
        if (this.contents) trackBitmapOwner(this.contents, this);
        return result;
      };

      const windowMove = Window.prototype.move;
      Window.prototype.move = function () {
        const result = windowMove.apply(this, arguments);
        scheduleFlush();
        return result;
      };

      const windowUpdateTransform = Window.prototype.updateTransform;
      Window.prototype.updateTransform = function () {
        const result = windowUpdateTransform.apply(this, arguments);
        if (overlayIsActive()) scheduleFlush();
        return result;
      };

      const windowDestroy = Window.prototype.destroy;
      if (typeof windowDestroy === "function") {
        Window.prototype.destroy = function () {
          forgetOwner(this);
          const result = windowDestroy.apply(this, arguments);
          scheduleFlush();
          return result;
        };
      }

      return true;
    };

    if (install()) return;
    setTimeout(installRpgMakerOverlayHooks, 250);
  }

  function installCanvasTextHooks() {
    const canvasContext = window.CanvasRenderingContext2D;
    const prototype = canvasContext && canvasContext.prototype;
    if (!prototype || prototype.__mzPlayerTextOverlayCanvasHooks) return;

    Object.defineProperty(prototype, "__mzPlayerTextOverlayCanvasHooks", {
      value: true,
      configurable: true,
    });

    const fillText = prototype.fillText;
    if (typeof fillText === "function") {
      prototype.fillText = function (text, x, y, maxWidth) {
        const result = fillText.apply(this, arguments);
        captureCanvasText(this, text, x, y, maxWidth);
        return result;
      };
    }

    const strokeText = prototype.strokeText;
    if (typeof strokeText === "function") {
      prototype.strokeText = function (text, x, y, maxWidth) {
        const result = strokeText.apply(this, arguments);
        captureCanvasText(this, text, x, y, maxWidth);
        return result;
      };
    }
  }

  function trackBitmapOwner(bitmap, owner) {
    if (!bitmap || !owner) return;
    overlayState.bitmapOwners.set(bitmap, owner);
    const context = bitmap._context;
    if (context) overlayState.contextOwners.set(context, { bitmap, owner });
  }

  function installSceneHooks() {
    installSceneManagerHooks();
    installSceneBaseHooks();
  }

  function installSceneManagerHooks() {
    if (overlayState.sceneHooksInstalled) return;

    const sceneManager = window.SceneManager;
    if (!sceneManager) {
      setTimeout(installSceneHooks, 250);
      return;
    }

    overlayState.sceneHooksInstalled = true;
    overlayState.lastScene = sceneManager._scene || null;

    const changeScene = sceneManager.changeScene;
    if (typeof changeScene === "function") {
      sceneManager.changeScene = function () {
        const result = changeScene.apply(this, arguments);
        handleSceneMaybeChanged(this._scene || null);
        return result;
      };
    }

    const updateScene = sceneManager.updateScene;
    if (typeof updateScene === "function") {
      sceneManager.updateScene = function () {
        const result = updateScene.apply(this, arguments);
        handleSceneMaybeChanged(this._scene || null);
        return result;
      };
    }
  }

  function installSceneBaseHooks() {
    if (overlayState.sceneBaseHooksInstalled) return;

    const sceneBase = window.Scene_Base;
    const terminate = sceneBase?.prototype?.terminate;
    if (typeof terminate !== "function") {
      setTimeout(installSceneBaseHooks, 250);
      return;
    }

    overlayState.sceneBaseHooksInstalled = true;
    sceneBase.prototype.terminate = function () {
      forgetScene(this);
      const result = terminate.apply(this, arguments);
      scheduleFlush();
      return result;
    };
  }

  function handleSceneMaybeChanged(scene) {
    if (scene === overlayState.lastScene) return;

    overlayState.lastScene = scene || null;
    pruneInvisibleEntries();
    scheduleFlush();
  }

  function pruneInvisibleEntries() {
    for (const [key, entry] of overlayState.entries) {
      if (!entryIsVisible(entry)) removeEntry(key, entry);
    }
  }

  function ownerId(owner) {
    if (!owner[OWNER_ID]) owner[OWNER_ID] = overlayState.nextOwnerId++;
    return owner[OWNER_ID];
  }

  function forgetBitmap(bitmap) {
    const owner = overlayState.bitmapOwners.get(bitmap);
    if (!owner) return;
    const idPrefix = `${ownerId(owner)}:`;
    for (const [key, entry] of overlayState.entries) {
      if (entry.owner === owner || key.startsWith(idPrefix)) removeEntry(key, entry);
    }
    for (const key of overlayState.lineGroups.keys()) {
      if (key.startsWith(idPrefix)) overlayState.lineGroups.delete(key);
    }
  }

  function forgetBitmapRect(bitmap, x, y, width, height) {
    const owner = overlayState.bitmapOwners.get(bitmap);
    if (!owner) return;
    const clearRect = {
      x: Number(x) || 0,
      y: Number(y) || 0,
      width: Number(width) || 0,
      height: Number(height) || 0,
    };
    if (clearRect.width >= bitmap.width * 0.9 && clearRect.height >= bitmap.height * 0.9) {
      forgetBitmap(bitmap);
      return;
    }
    for (const [key, entry] of overlayState.entries) {
      if (entry.owner === owner && rectsIntersect(clearRect, entry)) removeEntry(key, entry);
    }
    for (const [key, group] of overlayState.lineGroups) {
      if (group.owner === owner && rectsIntersect(clearRect, group)) {
        const entry = overlayState.entries.get(group.entryKey);
        if (entry) removeEntry(group.entryKey, entry);
        overlayState.lineGroups.delete(key);
      }
    }
  }

  function forgetScene(scene) {
    for (const [key, entry] of overlayState.entries) {
      if (ownerBelongsToScene(entry.owner, scene)) removeEntry(key, entry);
    }

    for (const [key, group] of overlayState.lineGroups) {
      if (ownerBelongsToScene(group.owner, scene)) overlayState.lineGroups.delete(key);
    }
  }

  function forgetOwner(owner) {
    for (const [key, entry] of overlayState.entries) {
      if (entry.owner === owner) removeEntry(key, entry);
    }

    for (const [key, group] of overlayState.lineGroups) {
      if (group.owner === owner) overlayState.lineGroups.delete(key);
    }
  }

  function removeEntry(key, entry) {
    if (entry) forgetLineGroupsForEntry(key);
    if (entry.element) entry.element.remove();
    overlayState.entries.delete(key);
  }

  function forgetLineGroupsForEntry(entryKey) {
    for (const [key, group] of overlayState.lineGroups) {
      if (group.entryKey === entryKey) overlayState.lineGroups.delete(key);
    }
  }

  function clearOverlayEntries() {
    if (overlayState.root) overlayState.root.replaceChildren();
    overlayState.entries.clear();
    overlayState.lineGroups.clear();
    for (const timer of overlayState.textLogTimers.values()) window.clearTimeout(timer);
    overlayState.textLogTimers.clear();
    overlayState.raf = 0;
  }

  function captureBitmapText(bitmap, rawText, x, y, maxWidth, lineHeight, align) {
    const owner = overlayState.bitmapOwners.get(bitmap);
    if (!owner || rawText === undefined || rawText === null) return;
    trackBitmapOwner(bitmap, owner);
    const text = String(rawText);
    if (!text) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const height = Number(lineHeight) || owner.lineHeight?.() || bitmap.fontSize || 24;
    const widthLimit = Number(maxWidth) || 0xffffffff;
    if (y < -height || y >= bitmap.height || x > bitmap.width || x + widthLimit < 0) return;
    if (owner._checkWordWrapMode) return;

    const measuredWidth = safeMeasure(bitmap, text);
    const adjustedX = adjustedTextLeft(x, widthLimit, measuredWidth, align);
    const normalizedY = Math.round(y);
    const alignmentBox = alignmentTextBox(x, widthLimit, measuredWidth, align);

    if (text.length === 1) {
      captureLineCharacter(owner, bitmap, text, adjustedX, normalizedY, measuredWidth, height);
      return;
    }

    const key = [
      ownerId(owner),
      Math.round(alignmentBox.x),
      normalizedY,
      Math.round(alignmentBox.width),
      Math.round(height),
      alignmentBox.textAlign,
      hashText(text),
    ].join(":");

    upsertEntry(key, {
      owner,
      bitmap,
      text,
      x: alignmentBox.x,
      y: normalizedY,
      width: alignmentBox.width,
      height,
      fontSize: bitmap.fontSize || owner.standardFontSize?.() || 24,
      fontFace: bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
      textAlign: alignmentBox.textAlign,
      updatedAt: performance.now(),
    });
  }

  function captureCanvasText(context, rawText, x, y, maxWidth) {
    if (overlayState.canvasTextCaptureDepth > 0) return;
    const binding = overlayState.contextOwners.get(context);
    if (!binding?.owner || rawText === undefined || rawText === null) return;

    const text = String(rawText);
    if (!text) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const bitmap = binding.bitmap;
    const owner = binding.owner;
    const fontSize = canvasFontSize(context, bitmap, owner);
    const height = Math.max(1, owner.lineHeight?.() || Math.ceil(fontSize * 1.25));
    const measuredWidth = safeMeasureCanvas(context, bitmap, text);
    const width = Math.max(1, Math.min(measuredWidth, Number(maxWidth) || measuredWidth));
    const left = canvasTextLeft(x, width, context.textAlign);
    const top = canvasTextTop(y, fontSize, height, context.textBaseline);

    if (top < -height || top >= bitmap.height || left > bitmap.width || left + width < 0) return;
    if (owner._checkWordWrapMode) return;

    const key = [
      ownerId(owner),
      "canvas",
      Math.round(left),
      Math.round(top),
      Math.round(width),
      Math.round(height),
      hashText(text),
    ].join(":");

    upsertEntry(key, {
      owner,
      bitmap,
      text,
      x: left,
      y: top,
      width,
      height,
      fontSize,
      fontFace: canvasFontFace(context) || bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
      textAlign: "left",
      updatedAt: performance.now(),
    });
  }

  function captureLineCharacter(owner, bitmap, text, x, y, measuredWidth, height) {
    const ownerKey = ownerId(owner);
    const key = `${ownerKey}:line:${Math.round(y)}:${Math.round(height)}:${bitmap.fontSize || ""}:${bitmap.fontFace || ""}`;
    const now = performance.now();
    let group = overlayState.lineGroups.get(key);

    if (!group || x < group.lastX - Math.max(8, height * 0.35) || now - group.updatedAt > 5000) {
      group = {
        owner,
        bitmap,
        text: "",
        x,
        y,
        width: 0,
        height,
        fontSize: bitmap.fontSize || owner.standardFontSize?.() || 24,
        fontFace: bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
        lastX: x,
        updatedAt: now,
        entryKey: key,
      };
      overlayState.lineGroups.set(key, group);
    }

    group.text += text;
    group.x = Math.min(group.x, x);
    group.width = Math.max(group.width, x + measuredWidth - group.x);
    group.lastX = x + measuredWidth;
    group.updatedAt = now;

    upsertEntry(group.entryKey, {
      owner: group.owner,
      bitmap: group.bitmap,
      text: group.text,
      x: group.x,
      y: group.y,
      width: Math.max(group.width, 1),
      height: group.height,
      fontSize: group.fontSize,
      fontFace: group.fontFace,
      updatedAt: group.updatedAt,
    });
  }

  function safeMeasure(bitmap, text) {
    try {
      return Math.max(1, bitmap.measureTextWidth(text));
    } catch {
      return Math.max(1, text.length * (bitmap.fontSize || 24) * 0.6);
    }
  }

  function safeMeasureCanvas(context, bitmap, text) {
    try {
      return Math.max(1, context.measureText(text).width);
    } catch {
      return Math.max(1, text.length * (canvasFontSize(context, bitmap, null) || 24) * 0.6);
    }
  }

  function canvasFontSize(context, bitmap, owner) {
    const match = String(context.font || "").match(/(\d+(?:\.\d+)?)px/);
    const parsed = match ? Number(match[1]) : 0;
    return parsed || bitmap?.fontSize || owner?.standardFontSize?.() || 24;
  }

  function canvasFontFace(context) {
    const font = String(context.font || "").trim();
    if (!font) return "";
    const match = font.match(/\d+(?:\.\d+)?px\s+(.+)$/);
    return match ? match[1] : "";
  }

  function canvasTextLeft(x, width, align) {
    if (align === "center") return x - width / 2;
    if (align === "right" || align === "end") return x - width;
    return x;
  }

  function canvasTextTop(y, fontSize, height, baseline) {
    if (baseline === "top" || baseline === "hanging") return y;
    if (baseline === "middle") return y - height / 2;
    if (baseline === "bottom" || baseline === "ideographic") return y - height;
    return y - fontSize;
  }

  function adjustedTextLeft(x, maxWidth, measuredWidth, align) {
    if (align === "center") return x + Math.max(0, (maxWidth - measuredWidth) / 2);
    if (align === "right") return x + Math.max(0, maxWidth - measuredWidth);
    return x;
  }

  function alignmentTextBox(x, maxWidth, measuredWidth, align) {
    const widthLimit = Number(maxWidth) || 0;
    const canUseBox = (align === "center" || align === "right") && widthLimit > 0 && widthLimit < 0xffffffff;

    if (canUseBox) {
      return {
        x,
        width: Math.max(widthLimit, 1),
        textAlign: align,
      };
    }

    return {
      x: adjustedTextLeft(x, maxWidth, measuredWidth, align),
      width: Math.max(measuredWidth, 1),
      textAlign: "left",
    };
  }

  function upsertEntry(key, next) {
    const current = overlayState.entries.get(key) || {};
    Object.assign(current, next);
    overlayState.entries.set(key, current);
    scheduleTextLog(key, current);
    scheduleFlush();
  }

  function scheduleTextLog(key, entry) {
    if (!entryIsLoggable(entry)) return;
    const text = String(entry.text || "");
    const dedupeKey = textLogDedupeKey(text);
    if (!dedupeKey) return;

    replaceTextLogTimer(key, () => {
      overlayState.textLogTimers.delete(key);
      if (overlayState.textLogValues.get(key) === dedupeKey) return;
      overlayState.textLogValues.set(key, dedupeKey);
      postParentMessage({ type: "text-log", gameId: config.gameId, text, at: Date.now() });
    });
  }

  function textLogDedupeKey(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function replaceTextLogTimer(key, callback) {
    const existing = overlayState.textLogTimers.get(key);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(callback, TEXT_LOG_DELAY_MS);
    overlayState.textLogTimers.set(key, timer);
  }

  function entryIsLoggable(entry) {
    const name = entry?.owner?.constructor?.name || "";
    return /^(Window_Message|Window_ChoiceList|Window_NameBox|Window_ScrollText)$/.test(name);
  }

  function scheduleFlush() {
    if (overlayState.raf) return;
    overlayState.raf = requestAnimationFrame(() => {
      overlayState.raf = 0;
      flushOverlay();
    });
  }

  function flushOverlay() {
    ensureOverlayDom();
    if (!overlayIsActive()) return;

    for (const [key, entry] of overlayState.entries) {
      if (!entryIsVisible(entry)) {
        removeEntry(key, entry);
        continue;
      }

      const rect = toPageRect(entry);
      if (!rect) {
        removeEntry(key, entry);
        continue;
      }

      if (!entry.element) {
        entry.element = document.createElement("span");
        entry.element.className = "mz-player-text-overlay-entry";
        overlayState.root.appendChild(entry.element);
      }

      if (entry.element.textContent !== entry.text) {
        entry.element.textContent = entry.text;
        entry.element.setAttribute("aria-label", entry.text);
        entry.element.dataset.rpgText = entry.text;
        entry.element.removeAttribute("title");
      }

      setStyleIfChanged(entry.element, "left", `${rect.left}px`);
      setStyleIfChanged(entry.element, "top", `${rect.top}px`);
      setStyleIfChanged(entry.element, "width", `${Math.max(1, rect.width)}px`);
      setStyleIfChanged(entry.element, "height", `${Math.max(1, rect.height)}px`);
      setStyleIfChanged(entry.element, "font", `${Math.max(1, rect.fontSize)}px ${entry.fontFace || "sans-serif"}`);
      setStyleIfChanged(entry.element, "lineHeight", `${Math.max(1, rect.height)}px`);
      setStyleIfChanged(entry.element, "textAlign", entry.textAlign || "left");
    }
  }

  function setStyleIfChanged(element, name, value) {
    if (element.style[name] !== value) element.style[name] = value;
  }

  function entryIsVisible(entry) {
    const owner = entry.owner;
    if (!owner || owner.destroyed || !owner.parent) return false;
    if (!ownerBelongsToActiveScene(owner)) return false;
    if (typeof owner.isClosed === "function" && owner.isClosed()) return false;
    return displayObjectIsVisible(owner);
  }

  function ownerBelongsToActiveScene(owner) {
    const scene = currentScene();
    if (!scene) return true;
    return ownerBelongsToScene(owner, scene);
  }

  function ownerBelongsToScene(owner, scene) {
    let current = owner;
    let guard = 0;
    while (current && guard++ < 30) {
      if (current === scene) return true;
      current = current.parent;
    }
    return false;
  }

  function currentScene() {
    return window.SceneManager?._scene || overlayState.lastScene || null;
  }

  function toPageRect(entry) {
    const graphics = window.Graphics;
    const canvas = graphics && graphics._canvas;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const scaleX = rect.width / (graphics.width || canvas.width || rect.width || 1);
    const scaleY = rect.height / (graphics.height || canvas.height || rect.height || 1);
    const content = contentGeometry(entry);
    const clipped = intersectRects(entry, {
      x: content.originX,
      y: content.originY,
      width: content.visibleWidth,
      height: content.visibleHeight,
    });
    if (!clipped || clipped.width <= 0 || clipped.height <= 0) return null;

    const pageLeft = rect.left + (content.x - content.originX + clipped.x) * scaleX;
    const pageTop = rect.top + (content.y - content.originY + clipped.y) * scaleY;
    const pageWidth = clipped.width * scaleX;
    const pageHeight = clipped.height * scaleY;

    if (pageLeft >= rect.right || pageTop >= rect.bottom || pageLeft + pageWidth <= rect.left || pageTop + pageHeight <= rect.top) return null;

    return {
      left: roundCssPixel(pageLeft),
      top: roundCssPixel(pageTop),
      width: roundCssPixel(pageWidth),
      height: roundCssPixel(pageHeight),
      fontSize: roundCssPixel((entry.fontSize || entry.height || 24) * Math.min(scaleX, scaleY)),
    };
  }

  function contentGeometry(entry) {
    const owner = entry.owner;
    const sprite = contentSpriteFor(owner, entry.bitmap);
    if (sprite) {
      const position = ownerWorldPosition(sprite);
      const frame = spriteFrame(sprite);
      return {
        x: position.x,
        y: position.y,
        originX: frame.x,
        originY: frame.y,
        visibleWidth: frame.width,
        visibleHeight: frame.height,
      };
    }

    const ownerPos = ownerWorldPosition(owner);
    const padding = Number(owner.padding) || 0;
    const originX = owner.origin ? Number(owner.origin.x) || 0 : 0;
    const originY = owner.origin ? Number(owner.origin.y) || 0 : 0;
    return {
      x: ownerPos.x + padding,
      y: ownerPos.y + padding,
      originX,
      originY,
      visibleWidth: Math.max(0, (Number(owner.width) || Number(owner._width) || 0) - padding * 2),
      visibleHeight: Math.max(0, (Number(owner.height) || Number(owner._height) || 0) - padding * 2),
    };
  }

  function contentSpriteFor(owner, bitmap) {
    const candidates = [
      owner && owner._windowContentsSprite,
      owner && owner._contentsSprite,
    ];
    const matching = candidates.find((sprite) => sprite && sprite.bitmap === bitmap);
    return matching || candidates.find(Boolean) || null;
  }

  function spriteFrame(sprite) {
    const frame = sprite && (sprite._frame || sprite._realFrame);
    const width = Number(frame && frame.width) || Number(sprite.width) || 0;
    const height = Number(frame && frame.height) || Number(sprite.height) || 0;
    return {
      x: Number(frame && frame.x) || 0,
      y: Number(frame && frame.y) || 0,
      width: Math.max(0, width),
      height: Math.max(0, height),
    };
  }

  function roundCssPixel(value) {
    return Math.round(value * 2) / 2;
  }

  function displayObjectIsVisible(object) {
    let current = object;
    let guard = 0;
    while (current && guard++ < 30) {
      if (current.visible === false || current.renderable === false || current.alpha === 0) return false;
      current = current.parent;
    }
    return true;
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function intersectRects(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function ownerWorldPosition(owner) {
    let x = 0;
    let y = 0;
    let current = owner;
    let guard = 0;
    while (current && guard++ < 20) {
      x += Number(current.x) || 0;
      y += Number(current.y) || 0;
      current = current.parent;
    }
    return { x, y };
  }

  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  return {
    clearGuardState,
    dictionaryGuardActive,
    ensureOverlayDom,
    focusGameTarget,
    installDictionaryGuardInputHooks,
    installRpgMakerOverlayHooks,
    refreshOverlayClasses,
    scheduleFlush,
  };
}
