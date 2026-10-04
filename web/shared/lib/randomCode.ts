const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// A random 7 character code, the same shape the service makes. Almost certainly never created.
export function randomCode(): string {
  return Array.from({ length: 7 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}
