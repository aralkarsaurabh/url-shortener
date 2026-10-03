export class AliasTakenError extends Error {
  constructor() {
    super('Alias already in use');
    this.name = 'AliasTakenError';
  }
}
