// ============================================================
// Write tools — registered only when WACRM_ENABLE_WRITES is set.
//
// These change data or send a WhatsApp message. They are gated so a
// read-only deployment never exposes them to the model at all. (The
// API key's scopes are still enforced server-side; a call without the
// right scope returns a clean `forbidden` error.)
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

const templateSchema = z
  .object({
    name: z.string().describe('Meta-approved template name.'),
    language: z.string().describe('Template language code, e.g. "en_US".'),
    params: z
      .array(z.string())
      .optional()
      .describe('Positional body variables, in order.'),
  })
  .describe('Template payload — required when type is "template".');

export function registerWriteTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'send_message',
    {
      title: 'Send WhatsApp message',
      description:
        'Send a WhatsApp message to a phone number (E.164, e.g. +14155550123). The contact and conversation are found-or-created automatically. Use type "text" for a free-form message (only valid inside the 24-hour customer-service window), or "template" to send an approved template (required to open a new conversation). Media types (image/video/document/audio) require a media_url. This sends a real message to a real person — confirm the recipient and content with the user before calling.',
      inputSchema: {
        to: z.string().describe('Recipient phone number in E.164 format, e.g. +14155550123.'),
        type: z
          .enum(['text', 'template', 'image', 'video', 'document', 'audio'])
          .default('text')
          .describe('Message type. Defaults to "text".'),
        text: z
          .string()
          .optional()
          .describe('Message body for "text", or the caption for a media type.'),
        media_url: z
          .string()
          .url()
          .optional()
          .describe('Publicly reachable URL of the media file (required for media types).'),
        filename: z.string().optional().describe('File name for a "document" send.'),
        template: templateSchema.optional(),
        reply_to_message_id: z
          .string()
          .optional()
          .describe('Optional id of a message in the same conversation to reply to.'),
      },
      annotations: { title: 'Send WhatsApp message', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.sendMessage(args))),
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Create contact',
      description:
        'Create a contact by phone number (E.164, required). Find-or-create: if a contact with that phone already exists it is returned unchanged. Optional: name, email, company, and tags (tag names, created if missing).',
      inputSchema: {
        phone: z.string().describe('Phone number in E.164 format, e.g. +14155550123.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Tag names; created if they do not exist.'),
      },
      annotations: { title: 'Create contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.createContact(args))),
  );

  server.registerTool(
    'update_contact',
    {
      title: 'Update contact',
      description:
        'Update an existing contact. Only the fields you pass are changed. Pass tags (an array of tag names) to replace the contact’s tags entirely. Lead qualification: temperature (cold/warm/hot), potential (0–100), segment, source, city, job_title, instagram, website.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        temperature: z
          .enum(['cold', 'warm', 'hot'])
          .optional()
          .describe('How ready the lead is to buy.'),
        potential: z
          .number()
          .int()
          .min(0)
          .max(100)
          .nullable()
          .optional()
          .describe('Lead score 0–100; null clears it.'),
        segment: z.string().nullable().optional(),
        source: z.string().nullable().optional().describe('Where the lead came from.'),
        city: z.string().nullable().optional(),
        job_title: z.string().nullable().optional(),
        instagram: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        tags: z.array(z.string()).optional().describe('Replaces the contact’s tags.'),
      },
      annotations: { title: 'Update contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateContact(id, body))),
  );

  server.registerTool(
    'update_deal',
    {
      title: 'Update deal',
      description:
        'Update an existing deal. Only the fields you pass are changed. Move it with stage_id (a stage of the deal’s own pipeline — see list_pipelines), or close it with status won / lost.',
      inputSchema: {
        id: z.string().describe('Deal id.'),
        stage_id: z.string().optional().describe('Target stage; must belong to the deal’s pipeline.'),
        status: z.enum(['open', 'won', 'lost']).optional(),
        title: z.string().min(1).optional(),
        value: z.number().min(0).optional(),
        notes: z.string().nullable().optional(),
        expected_close_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional()
          .describe('YYYY-MM-DD; null clears it.'),
      },
      annotations: { title: 'Update deal', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateDeal(id, body))),
  );
}
