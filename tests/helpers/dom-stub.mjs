/**
 * A minimal DOM stand-in for the UI modules.
 *
 * WHY hand-written rather than a full DOM emulator: the UI layer uses a small,
 * fixed slice of the DOM (createElement, textContent, append, replaceChildren,
 * class and id, one listener per node, inline style). Modelling just that keeps
 * the tests readable and makes assertions about structure direct, rather than
 * going through query selectors into an emulated document.
 *
 * `html` serialises with escaping so tests can prove that untrusted text never
 * becomes markup.
 */

/** One element in the stub tree. */
export class StubElement {
  constructor(tag, ownerDocument) {
    this.tag = tag;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this._text = "";
    this.className = "";
    this.id = "";
    this.type = "";
    this.src = "";
    this.alt = "";
    this.listeners = {};
    /** Inline style, including custom properties set via setProperty. */
    this.style = {
      properties: {},
      setProperty: (name, value) => {
        this.style.properties[name] = value;
      },
    };
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    return (
      this._text + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("")
    );
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
    this._text = "";
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  /** Fire a listener, as a user click would. */
  click() {
    this.listeners.click?.();
  }

  scrollIntoView(options) {
    this.ownerDocument.scrollCalls.push({ id: this.id, options });
  }

  /** Serialise with HTML escaping, mirroring how textContent actually behaves. */
  get html() {
    const escaped = this._text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const inner = this._text
      ? escaped
      : this.children.map((c) => (typeof c === "string" ? c : c.html)).join("");
    return `<${this.tag}>${inner}</${this.tag}>`;
  }

  /** Depth-first search for the first descendant carrying a class. */
  find(className) {
    if (this.className === className) return this;
    for (const child of this.children) {
      if (typeof child === "string") continue;
      const hit = child.find?.(className);
      if (hit) return hit;
    }
    return null;
  }

  /** Every descendant carrying a class, in document order. */
  findAll(className, found = []) {
    if (this.className === className) found.push(this);
    for (const child of this.children) {
      if (typeof child === "string") continue;
      child.findAll?.(className, found);
    }
    return found;
  }
}

/**
 * Build a stub document pre-populated with the ids index.html provides.
 *
 * The real page ships a skeleton of empty mount points, so the stub starts from
 * the same set. Anything the renderer looks up that is not in that list is
 * created on demand, which mirrors a lookup succeeding against real markup.
 */
export function createStubDocument({ ids = ["hero", "map-demo", "timeOverlay", "growthOverlay"] } = {}) {
  const doc = {
    title: "",
    scrollCalls: [],
    elements: {},
    body: null,
    createElement(tag) {
      return new StubElement(tag, doc);
    },
    getElementById(id) {
      return (doc.elements[id] ??= Object.assign(new StubElement("div", doc), { id }));
    },
    querySelector(selector) {
      return (doc.elements[selector] ??= Object.assign(new StubElement(selector, doc), {
        id: selector,
      }));
    },
  };

  for (const id of ids) doc.getElementById(id);

  // The renderer inserts content panels before the map section, so the map
  // section needs a parent that records those insertions in order.
  doc.body = new StubElement("body", doc);
  doc.elements["map-demo"].parentNode = {
    insertBefore: (node) => doc.body.children.push(node),
  };
  return doc;
}

/** A no-op IntersectionObserver that records what it was asked to watch. */
export function createObserverStub() {
  const observed = [];
  class Stub {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      Stub.instances.push(this);
    }
    observe(target) {
      observed.push(target);
    }
    /** Simulate the given targets scrolling into view. */
    reveal(targets) {
      this.callback(targets.map((target) => ({ target, isIntersecting: true })));
    }
  }
  Stub.instances = [];
  return { Stub, observed };
}
