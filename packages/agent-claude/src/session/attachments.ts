import { partsOf } from '@ahpd/sdk';
import type { MessageAttachment } from '@ahpd/sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/*
 * A turn's message, as the CLI's input takes it.
 *
 * The prompt handed to the CLI is a stream of user messages, and the content
 * of one is either the string a person typed or an array of blocks. `partsOf`
 * decides which of a message's attachments is an image, which is an inlined
 * text, and which is named by its path - a decision made once for every
 * backend. What is left here is the one thing that differs between them: the
 * block. Claude takes a text part as a text block and an image part as the
 * base64 source its own image block carries.
 */

/** One block of a prompt, as the CLI's input takes it. */
export type PromptBlock = Exclude<SDKUserMessage['message']['content'], string>[number];

/** The base64 source a picture is sent as, which is where the four types are. */
type ImageSource = Extract<Extract<PromptBlock, { type: 'image' }>['source'], { type: 'base64' }>;

/**
 * A message's text and attachments, as what the CLI is sent.
 *
 * The string a message with nothing attached has always been, because an
 * ordinary turn is that and this stream is the CLI's own; and the blocks the
 * parts became when it carried something.
 */
export async function blocksFor(
  text: string,
  attachments: MessageAttachment[] | undefined,
): Promise<SDKUserMessage['message']['content']> {
  if (attachments === undefined || attachments.length === 0) return text;
  const parts = await partsOf(text, attachments, { images: true });
  return parts.map((part): PromptBlock => (part.type === 'text'
    ? { type: 'text', text: part.text }
    // A part's own type is one of those four, which is the only kind `partsOf`
    // sends as an image.
    : { type: 'image', source: { type: 'base64', media_type: part.mimeType as ImageSource['media_type'], data: part.data } }));
}
