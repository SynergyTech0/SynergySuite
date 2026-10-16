import { PIECE_NAME } from "./engine";

/**
 * Ready-made flows built from the Synergy piece. A recipe fills in what it can (the person's own
 * address, the message text); the person picks the rest (which form, which channel) in the
 * designer and turns the flow on there.
 */

export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** Apps it uses, for the card. */
  apps: string[];
  build(ctx: { email: string; pieceVersion: string }): unknown;
}

/** The engine's flow schema these recipes are written in; the engine upgrades older ones itself. */
export const RECIPE_SCHEMA_VERSION = "27";

const NOW = "2026-01-01T00:00:00.000Z";
const AUTH = "{{connections['synergy']}}";

type Step = { name: string; displayName: string; action: string; input: Record<string, unknown> };

function trigger(t: { name: string; displayName: string; input: Record<string, unknown> }, steps: Step[], pieceVersion: string) {
  let next: unknown = undefined;
  for (const s of [...steps].reverse()) {
    next = {
      name: s.name,
      type: "PIECE",
      // A step with a blank the person must fill (null) starts invalid; the engine rechecks on every edit.
      valid: !Object.values(s.input).some((v) => v === null),
      displayName: s.displayName,
      lastUpdatedDate: NOW,
      settings: {
        pieceName: PIECE_NAME,
        pieceVersion,
        actionName: s.action,
        input: { auth: AUTH, ...s.input },
        propertySettings: {},
        errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } },
      },
      ...(next ? { nextAction: next } : {}),
    };
  }
  return {
    name: "trigger",
    type: "PIECE_TRIGGER",
    valid: false,
    displayName: t.displayName,
    lastUpdatedDate: NOW,
    settings: { pieceName: PIECE_NAME, pieceVersion, triggerName: t.name, input: { auth: AUTH, ...t.input }, propertySettings: {} },
    ...(next ? { nextAction: next } : {}),
  };
}

export const RECIPES: Recipe[] = [
  {
    id: "form-to-email",
    name: "Email me new form responses",
    description: "When someone responds to a form, send the answers to your inbox.",
    apps: ["Forms", "Mail"],
    build: ({ email, pieceVersion }) =>
      trigger({ name: "new_form_response", displayName: "New form response", input: { formId: null } }, [
        {
          name: "step_1",
          displayName: "Send an email",
          action: "send_email",
          input: { to: email, subject: "New response to {{trigger['output']['formTitle']}}", body: "{{trigger['output']['summary']}}", html: false },
        },
      ], pieceVersion),
  },
  {
    id: "form-to-todo",
    name: "Turn form responses into tasks",
    description: "When someone responds to a form, add a follow-up task to your To Do list.",
    apps: ["Forms", "To Do"],
    build: ({ pieceVersion }) =>
      trigger({ name: "new_form_response", displayName: "New form response", input: { formId: null } }, [
        {
          name: "step_1",
          displayName: "Add a To Do task",
          action: "create_todo",
          input: { title: "Follow up: {{trigger['output']['formTitle']}} response", notes: "{{trigger['output']['summary']}}", important: false },
        },
      ], pieceVersion),
  },
  {
    id: "email-to-chat",
    name: "Post new email to a Chat channel",
    description: "When an email arrives, post who it's from and its subject to a channel.",
    apps: ["Mail", "Chat"],
    build: ({ pieceVersion }) =>
      trigger({ name: "new_email", displayName: "New email", input: {} }, [
        {
          name: "step_1",
          displayName: "Post a Chat message",
          action: "post_chat_message",
          input: { channelId: null, body: "New email from {{trigger['output']['from']['address']}}: {{trigger['output']['subject']}}" },
        },
      ], pieceVersion),
  },
  {
    id: "form-to-ticket",
    name: "Open a Desk ticket from a form",
    description: "When someone fills in a support form, open a ticket for them in Desk.",
    apps: ["Forms", "Desk"],
    build: ({ pieceVersion }) =>
      trigger({ name: "new_form_response", displayName: "New form response", input: { formId: null } }, [
        {
          name: "step_1",
          displayName: "Open a Desk ticket",
          action: "create_ticket",
          input: { subject: "{{trigger['output']['formTitle']}}", requesterEmail: "{{trigger['output']['answers']['Email']}}", body: "{{trigger['output']['summary']}}", priority: "normal" },
        },
      ], pieceVersion),
  },
];

export function recipeById(id: string): Recipe | null {
  return RECIPES.find((r) => r.id === id) ?? null;
}
