/** Erreur métier renvoyée telle quelle au client : { error: { code, message } }. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
