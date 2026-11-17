export class DomainError extends Error {
  constructor(message: string, public code: string = "domain") {
    super(message);
  }
}
export class ConflictError extends DomainError {
  constructor(message = "Deze kaart is ondertussen gewijzigd (bijv. op een ander apparaat). Het bord is ververst.") {
    super(message, "conflict");
  }
}
export class NotFoundError extends DomainError {
  constructor(what = "Item") {
    super(`${what} niet gevonden`, "not_found");
  }
}
