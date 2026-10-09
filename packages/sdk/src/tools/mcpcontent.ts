/**
 * A client's answer, as the MCP content an agent reads.
 *
 * The protocol and MCP say the same thing in two vocabularies, and this is the
 * one conversion between them: a text block is a text block, an image is an
 * image, and an embedded resource that is not an image - a PDF, an archive - is
 * a resource blob, because MCP has no inline form for one. What neither
 * vocabulary has is put in the text as its JSON, so a block this does not know
 * about is still something the model can read rather than something dropped.
 *
 * A backend hands the whole answer over and this decides what an agent sees;
 * the answer's `text` is the fallback for one that carried no blocks at all,
 * which is an answer that still said something.
 */

import type { Bag } from '../types/common.js';
import type { ClientCallAnswer } from './clientcalls.js';

/**
 * Where a resource blob's URI points.
 *
 * Nowhere, deliberately: the bytes travel in the block, and the URI is the name
 * the client uses to refer to them, which has to be unique within the answer
 * and stable for it. Nothing dereferences one, so a scheme of this host's own
 * says that better than a plausible `file:` would.
 */
const BLOB_URI = 'ahp-tool-result:';

/** Whether a content type is one MCP calls an image. */
const isImage = (contentType: string): boolean => contentType.startsWith('image/');

/**
 * One answer's blocks as MCP content, in the order the client sent them.
 *
 * `callId` names the call the blocks belong to, which is what keeps two
 * embedded resources in one answer apart.
 */
export const toMcpContent = (answer: ClientCallAnswer, callId: string): Bag[] => {
  if (answer.content.length === 0) return [{ type: 'text', text: answer.text }];
  return answer.content.map((block, at) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'embeddedResource') {
      return isImage(block.contentType)
        ? { type: 'image', data: block.data, mimeType: block.contentType }
        : {
          type: 'resource',
          resource: {
            uri: `${BLOB_URI}${encodeURIComponent(callId)}/${at}`,
            mimeType: block.contentType,
            blob: block.data,
          },
        };
    }
    return { type: 'text', text: JSON.stringify(block) };
  });
};
