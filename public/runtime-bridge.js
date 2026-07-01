(function () {
  const config = window.__MZ_PLAYER_BRIDGE__;
  if (!config || !config.gameId || window.__mzPlayerBridgeInstalled) return;
  window.__mzPlayerBridgeInstalled = true;

  const OWNER_ID = "__mzPlayerTextOverlayOwnerId";
  let settings = normalizeSettings(config.settings);
  const prefix = `mz-player:${config.gameId}:`;
  const overlayState = {
    nextOwnerId: 1,
    bitmapOwners: new WeakMap(),
    entries: new Map(),
    lineGroups: new Map(),
    textLogTimers: new Map(),
    textLogValues: new Map(),
    consumedGuardKeyCodes: new Set(),
    hoveredTextEntry: null,
    raf: 0,
    installedHooks: false,
    inputGuardInstalled: false,
    focusReturnInstalled: false,
    root: null,
    style: null
  };
  let latestPlayerViewport = null;
  let lastAppliedViewport = "";
  let viewportFitFrame = 0;

  patchLocalStorage(prefix);
  installReservedKeys();
  installMessageBridge();
  installErrorBridge();
  installViewportBridge();
  ensureOverlayDom();
  installRpgMakerOverlayHooks();
  installDictionaryGuardInputHooks();
  refreshOverlayClasses();
  postStatus();

  function normalizeSettings(next) {
    const normalized = next || {};
    const overlayEnabled = Boolean(normalized.overlayEnabled);
    return {
      reservedKeys: normalized.reservedKeys || [],
      dictionaryDismissGuard: normalizeDictionaryDismissGuard(normalized.dictionaryDismissGuard),
      overlayEnabled,
      readableOverlay: overlayEnabled && Boolean(normalized.readableOverlay),
      readerMode: overlayEnabled
    };
  }

  function normalizeDictionaryDismissGuard(next) {
    const guard = next || {};
    const triggers = Array.isArray(guard.triggers) && guard.triggers.length > 0
      ? guard.triggers.map(normalizeKeyChord).filter(Boolean)
      : [];
    return {
      enabled: guard.enabled !== false,
      triggers
    };
  }

  function normalizeKeyChord(chord) {
    if (!chord || typeof chord !== "object") return null;
    return {
      code: typeof chord.code === "string" && chord.code ? chord.code : undefined,
      altKey: Boolean(chord.altKey),
      ctrlKey: Boolean(chord.ctrlKey),
      metaKey: Boolean(chord.metaKey),
      shiftKey: Boolean(chord.shiftKey),
      label: typeof chord.label === "string" && chord.label ? chord.label : "Key"
    };
  }

  function patchLocalStorage(namespace) {
    const original = {
      getItem: Storage.prototype.getItem,
      setItem: Storage.prototype.setItem,
      removeItem: Storage.prototype.removeItem,
      clear: Storage.prototype.clear,
      key: Storage.prototype.key,
      length: Object.getOwnPropertyDescriptor(Storage.prototype, "length")
    };

    const namespaced = (key) => String(key).startsWith(namespace) ? String(key) : `${namespace}${String(key)}`;
    const isLocal = (target) => target === window.localStorage;
    const localKeys = () => {
      const keys = [];
      for (let index = 0; index < original.length.get.call(window.localStorage); index += 1) {
        const key = original.key.call(window.localStorage, index);
        if (key && key.startsWith(namespace)) keys.push(key);
      }
      return keys;
    };

    Storage.prototype.getItem = function (key) {
      return original.getItem.call(this, isLocal(this) ? namespaced(key) : key);
    };
    Storage.prototype.setItem = function (key, value) {
      return original.setItem.call(this, isLocal(this) ? namespaced(key) : key, value);
    };
    Storage.prototype.removeItem = function (key) {
      return original.removeItem.call(this, isLocal(this) ? namespaced(key) : key);
    };
    Storage.prototype.clear = function () {
      if (!isLocal(this)) return original.clear.call(this);
      for (const key of localKeys()) original.removeItem.call(this, key);
      return undefined;
    };
    Storage.prototype.key = function (index) {
      if (!isLocal(this)) return original.key.call(this, index);
      const key = localKeys()[index] || null;
      return key ? key.slice(namespace.length) : null;
    };

    try {
      Object.defineProperty(Storage.prototype, "length", {
        configurable: true,
        get() {
          if (this !== window.localStorage) return original.length.get.call(this);
          return localKeys().length;
        }
      });
    } catch {
      // Some browsers may not allow overriding the getter; RPG Maker uses methods.
    }
  }

  function installReservedKeys() {
    window.addEventListener(
      "keydown",
      (event) => {
        const match = (settings.reservedKeys || []).find((key) =>
          event.code === key.code &&
          Boolean(event.altKey) === Boolean(key.altKey) &&
          Boolean(event.ctrlKey) === Boolean(key.ctrlKey) &&
          Boolean(event.metaKey) === Boolean(key.metaKey) &&
          Boolean(event.shiftKey) === Boolean(key.shiftKey)
        );
        if (!match) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        if (match.action === "toggleOverlay") {
          settings = settings.overlayEnabled
            ? { ...settings, overlayEnabled: false, readableOverlay: false, readerMode: false }
            : { ...settings, overlayEnabled: true, readableOverlay: false, readerMode: true };
        }
        if (match.action === "toggleReader") {
          if (!settings.overlayEnabled) return;
          settings = { ...settings, readableOverlay: !settings.readableOverlay, readerMode: true };
        }
        refreshOverlayClasses();
        postParent({ type: "reserved-key", action: match.action, code: event.code });
        postStatus();
      },
      true
    );
  }

  function installMessageBridge() {
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "player-settings") {
        settings = normalizeSettings(message.settings);
        if (!dictionaryGuardActive()) {
          clearGuardState();
        }
      }
      if (message.type === "overlay-visible") settings = normalizeSettings({ ...settings, overlayEnabled: Boolean(message.enabled) });
      if (message.type === "reader-mode") {
        settings = normalizeSettings({ ...settings, overlayEnabled: message.enabled ? true : settings.overlayEnabled });
      }
      if (message.type === "focus-game") {
        refreshOverlayClasses();
        focusGameTarget();
        return;
      }
      if (message.type === "player-viewport") {
        const width = Number(message.width);
        const height = Number(message.height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          latestPlayerViewport = { width, height };
          scheduleViewportFit();
        }
        return;
      }
      refreshOverlayClasses();
      postStatus();
    });
  }

  function installErrorBridge() {
    window.addEventListener("error", (event) => {
      postParent({ type: "runtime-error", message: String(event.message || "Runtime error"), stack: event.error && event.error.stack });
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason || {};
      postParent({ type: "runtime-error", message: String(reason.message || reason || "Unhandled rejection"), stack: reason.stack });
    });
  }

  function installViewportBridge() {
    const notify = () => {
      const graphics = window.Graphics || {};
      const canvas = graphics._canvas || document.querySelector("canvas");
      const width = Number(graphics.width || canvas?.width || 816);
      const height = Number(graphics.height || canvas?.height || 624);
      if (width > 0 && height > 0) {
        postParent({ type: "game-viewport", width, height });
      }
    };

    notify();
    window.addEventListener("resize", notify);
    const timer = window.setInterval(() => {
      notify();
      if (window.Graphics && (window.Graphics.width || window.Graphics._canvas)) {
        window.clearInterval(timer);
      }
    }, 250);
    window.addEventListener("resize", scheduleViewportFit);
    scheduleViewportFit();
  }

  function playerFrameRect() {
    try {
      const rect = window.frameElement?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    } catch {
      // Ignore unusual embed contexts.
    }
    return null;
  }

  function playerViewport() {
    const rect = playerFrameRect();
    return {
      width: rect?.width || latestPlayerViewport?.width || window.innerWidth || document.documentElement.clientWidth,
      height: rect?.height || latestPlayerViewport?.height || window.innerHeight || document.documentElement.clientHeight
    };
  }

  function notifyRpgMakerViewport(width, height) {
    const graphics = window.Graphics;
    if (!graphics || typeof graphics !== "object") return;

    const nativeWidth = Number(graphics.width || graphics._width || 0);
    const nativeHeight = Number(graphics.height || graphics._height || 0);
    const viewportKey = `${width}x${height}@${nativeWidth}x${nativeHeight}`;
    if (viewportKey === lastAppliedViewport) return;
    lastAppliedViewport = viewportKey;

    try {
      if (typeof graphics._onWindowResize === "function") {
        graphics._onWindowResize();
      } else if (typeof graphics._updateAllElements === "function") {
        graphics._updateAllElements();
      }
    } catch (error) {
      lastAppliedViewport = "";
      console.warn("[MZ Browser Player viewport] Could not notify RPG Maker resize.", error);
    }
  }

  function rpgMakerNativeSize() {
    const graphics = window.Graphics;
    if (!graphics || typeof graphics !== "object") return null;
    const width = Number(graphics.width || graphics._width || graphics.boxWidth || 0);
    const height = Number(graphics.height || graphics._height || graphics.boxHeight || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function containedRect(viewportWidth, viewportHeight, nativeWidth, nativeHeight) {
    const scale = Math.min(viewportWidth / nativeWidth, viewportHeight / nativeHeight);
    const width = Math.max(1, Math.floor(nativeWidth * scale));
    const height = Math.max(1, Math.floor(nativeHeight * scale));
    return {
      left: Math.floor((viewportWidth - width) / 2),
      top: Math.floor((viewportHeight - height) / 2),
      width,
      height
    };
  }

  function applyDocumentViewport(width, height) {
    document.documentElement.style.background = "#000";
    document.documentElement.style.width = `${width}px`;
    document.documentElement.style.height = `${height}px`;
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "#000";
    document.body.style.margin = "0";
    document.body.style.width = `${width}px`;
    document.body.style.height = `${height}px`;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.inset = "0";
  }

  function playerLayers() {
    return Array.from(document.querySelectorAll("canvas, video"));
  }

  function layerNativeSize(layer) {
    const width = Number(layer.videoWidth || layer.width || 0);
    const height = Number(layer.videoHeight || layer.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function applyLayerRect(layer, rect) {
    layer.style.position = "absolute";
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.right = "auto";
    layer.style.bottom = "auto";
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
    layer.style.maxWidth = "none";
    layer.style.maxHeight = "none";
    layer.style.transform = "";
    layer.style.transformOrigin = "";
    layer.style.objectFit = "";
  }

  function applyGenericContainedFit(viewportWidth, viewportHeight) {
    for (const layer of playerLayers()) {
      const nativeSize = layerNativeSize(layer);
      if (!nativeSize) continue;
      applyLayerRect(layer, containedRect(viewportWidth, viewportHeight, nativeSize.width, nativeSize.height));
    }
  }

  function applyRpgMakerFit(viewportWidth, viewportHeight) {
    const nativeSize = rpgMakerNativeSize();
    notifyRpgMakerViewport(viewportWidth, viewportHeight);
    if (!nativeSize) {
      applyGenericContainedFit(viewportWidth, viewportHeight);
      return;
    }

    const rect = containedRect(viewportWidth, viewportHeight, nativeSize.width, nativeSize.height);
    for (const layer of playerLayers()) {
      applyLayerRect(layer, rect);
    }
  }

  function applyViewportFit() {
    const { width, height } = playerViewport();
    if (!width || !height) return;

    applyDocumentViewport(width, height);
    if (window.Graphics && typeof window.Graphics === "object") {
      applyRpgMakerFit(width, height);
      scheduleFlush();
      return;
    }
    applyGenericContainedFit(width, height);
  }

  function scheduleViewportFit() {
    if (viewportFitFrame) return;
    viewportFitFrame = window.requestAnimationFrame(() => {
      viewportFitFrame = 0;
      try {
        applyViewportFit();
      } catch (error) {
        console.warn("[MZ Browser Player viewport] Could not fit player viewport.", error);
      }
    });
  }

  function scheduleViewportFitOld() {
    window.requestAnimationFrame(() => {
      try {
        applyViewportFit();
      } catch (error) {
        console.warn("[MZ Browser Player viewport] Could not fit player viewport.", error);
      }
    });
  }

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
          padding: 0 1px;
          line-height: 1;
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

    const consumeOverlayPointer = (event) => {
      const entry = overlayTextEntry(event.target);
      if (!entry) return;
      overlayState.hoveredTextEntry = entry;
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      if (event.type === "pointerup" || event.type === "mouseup" || event.type === "click" || event.type === "touchend") returnFocus();
    };

    const returnFocus = () => {
      if (!settings.readerMode) return;
      window.setTimeout(() => {
        postParent({ type: "return-focus" });
      }, 0);
    };

    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend"]) {
      window.addEventListener(type, consumeOverlayPointer, true);
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

  function exactModifierMatch(event, trigger) {
    return (
      Boolean(event.altKey) === Boolean(trigger.altKey) &&
      Boolean(event.ctrlKey) === Boolean(trigger.ctrlKey) &&
      Boolean(event.metaKey) === Boolean(trigger.metaKey) &&
      Boolean(event.shiftKey) === Boolean(trigger.shiftKey)
    );
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
      const bitmapDrawText = Bitmap.prototype.drawText;
      Bitmap.prototype.drawText = function (text, x, y, maxWidth, lineHeight, align) {
        const result = bitmapDrawText.apply(this, arguments);
        captureBitmapText(this, text, x, y, maxWidth, lineHeight, align);
        return result;
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
        if (this.contents) overlayState.bitmapOwners.set(this.contents, this);
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

      return true;
    };

    if (install()) return;
    setTimeout(installRpgMakerOverlayHooks, 250);
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
      height: Number(height) || 0
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

  function removeEntry(key, entry) {
    if (entry.element) entry.element.remove();
    overlayState.entries.delete(key);
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

    if (text.length === 1) {
      captureLineCharacter(owner, bitmap, text, adjustedX, normalizedY, measuredWidth, height);
      return;
    }

    const key = [
      ownerId(owner),
      Math.round(adjustedX),
      normalizedY,
      Math.round(measuredWidth),
      Math.round(height),
      hashText(text)
    ].join(":");

    upsertEntry(key, {
      owner,
      text,
      x: adjustedX,
      y: normalizedY,
      width: Math.max(measuredWidth, 1),
      height,
      fontSize: bitmap.fontSize || owner.standardFontSize?.() || 24,
      fontFace: bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
      updatedAt: performance.now()
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
        text: "",
        x,
        y,
        width: 0,
        height,
        fontSize: bitmap.fontSize || owner.standardFontSize?.() || 24,
        fontFace: bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
        lastX: x,
        updatedAt: now,
        entryKey: key
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
      text: group.text,
      x: group.x,
      y: group.y,
      width: Math.max(group.width, 1),
      height: group.height,
      fontSize: group.fontSize,
      fontFace: group.fontFace,
      updatedAt: group.updatedAt
    });
  }

  function safeMeasure(bitmap, text) {
    try {
      return Math.max(1, bitmap.measureTextWidth(text));
    } catch {
      return Math.max(1, text.length * (bitmap.fontSize || 24) * 0.6);
    }
  }

  function adjustedTextLeft(x, maxWidth, measuredWidth, align) {
    if (align === "center") return x + Math.max(0, (maxWidth - measuredWidth) / 2);
    if (align === "right") return x + Math.max(0, maxWidth - measuredWidth);
    return x;
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
    const text = String(entry.text || "").replace(/\s+/g, " ").trim();
    if (!text) return;

    const existing = overlayState.textLogTimers.get(key);
    if (existing) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      overlayState.textLogTimers.delete(key);
      if (overlayState.textLogValues.get(key) === text) return;
      overlayState.textLogValues.set(key, text);
      postParent({ type: "text-log", gameId: config.gameId, text, at: Date.now() });
    }, 140);
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
    }
  }

  function setStyleIfChanged(element, name, value) {
    if (element.style[name] !== value) element.style[name] = value;
  }

  function entryIsVisible(entry) {
    const owner = entry.owner;
    if (!owner || owner.destroyed || !owner.parent) return false;
    if (typeof owner.isClosed === "function" && owner.isClosed()) return false;
    return displayObjectIsVisible(owner);
  }

  function toPageRect(entry) {
    const graphics = window.Graphics;
    const canvas = graphics && graphics._canvas;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const scaleX = rect.width / (graphics.width || canvas.width || rect.width || 1);
    const scaleY = rect.height / (graphics.height || canvas.height || rect.height || 1);
    const ownerPos = ownerWorldPosition(entry.owner);
    const padding = Number(entry.owner.padding) || 0;
    const originX = entry.owner.origin ? Number(entry.owner.origin.x) || 0 : 0;
    const originY = entry.owner.origin ? Number(entry.owner.origin.y) || 0 : 0;
    const visibleWidth = Math.max(0, (Number(entry.owner.width) || Number(entry.owner._width) || 0) - padding * 2);
    const visibleHeight = Math.max(0, (Number(entry.owner.height) || Number(entry.owner._height) || 0) - padding * 2);
    const clipped = intersectRects(entry, { x: originX, y: originY, width: visibleWidth, height: visibleHeight });
    if (!clipped || clipped.width <= 0 || clipped.height <= 0) return null;

    const pageLeft = rect.left + (ownerPos.x + padding - originX + clipped.x) * scaleX;
    const pageTop = rect.top + (ownerPos.y + padding - originY + clipped.y) * scaleY;
    const pageWidth = clipped.width * scaleX;
    const pageHeight = clipped.height * scaleY;

    if (pageLeft >= rect.right || pageTop >= rect.bottom || pageLeft + pageWidth <= rect.left || pageTop + pageHeight <= rect.top) return null;

    return {
      left: roundCssPixel(pageLeft),
      top: roundCssPixel(pageTop),
      width: roundCssPixel(pageWidth),
      height: roundCssPixel(pageHeight),
      fontSize: roundCssPixel((entry.fontSize || entry.height || 24) * Math.min(scaleX, scaleY))
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

  function postStatus() {
    postParent({ type: "overlay-status", overlayEnabled: settings.overlayEnabled, readerMode: settings.readerMode });
  }

  function postParent(message) {
    try {
      window.parent.postMessage(message, window.location.origin);
    } catch {
      window.parent.postMessage(message, "*");
    }
  }
})();
