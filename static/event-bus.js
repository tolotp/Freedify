/**
 * Freedify Event Bus
 * Simple pub/sub to break circular dependencies between modules
 */
const listeners = {};

export function on(event, fn) {
    (listeners[event] ||= []).push(fn);
}

export function off(event, fn) {
    if (listeners[event]) {
        listeners[event] = listeners[event].filter(f => f !== fn);
    }
}

export function emit(event, ...args) {
    (listeners[event] || []).forEach(fn => fn(...args));
}
