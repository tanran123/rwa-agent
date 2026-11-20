const stack = [];
let seq = 0;

export function nextDrawerId() {
  seq += 1;
  return "drawer-" + seq;
}

export function setDrawerOpen(id, open) {
  const index = stack.indexOf(id);
  if (open) {
    if (index < 0) stack.push(id);
    return;
  }
  if (index >= 0) stack.splice(index, 1);
}

export function isTopDrawer(id) {
  return stack.length > 0 && stack[stack.length - 1] === id;
}
