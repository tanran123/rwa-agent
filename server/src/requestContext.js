import { AsyncLocalStorage } from "node:async_hooks";

// Per-request context so helpers that spawn Python can find the current account.
export const requestContext = new AsyncLocalStorage();
