// A made-up client address. Sent as X-Forwarded-For, it lets each experiment act as its own client,
// so one experiment's rate limit does not use up the next one's. It only works when the service
// runs with TRUST_PROXY=1.
export function randomClientIp(): string {
  const part = (max: number) => Math.floor(Math.random() * max);
  return `10.${part(255)}.${part(255)}.${1 + part(254)}`;
}
