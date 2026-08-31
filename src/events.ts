const REREVIEW_COMMAND = /^\/swarm-review(?:\s+(debate))?$/i;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export type RereviewCommand = "review" | "debate";

export function parseRereviewCommand(body: string): RereviewCommand | undefined {
  for (const line of body.split(/\r?\n/)) {
    const match = line.trim().match(REREVIEW_COMMAND);
    if (match) {
      return match[1] ? "debate" : "review";
    }
  }

  return undefined;
}

export function stripRereviewCommands(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !REREVIEW_COMMAND.test(line.trim()))
    .join("\n")
    .trim();
}

export function isTrustedRereviewActor(
  authorAssociation: unknown,
  userType: unknown
): boolean {
  const isBot = typeof userType === "string" && userType.toLowerCase() === "bot";
  return (
    !isBot &&
    typeof authorAssociation === "string" &&
    TRUSTED_ASSOCIATIONS.has(authorAssociation.toUpperCase())
  );
}
