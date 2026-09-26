/*
 * A module that throws as soon as it is imported.
 *
 * A listing has to say `ready` about it anyway, because a listing reads the
 * manifest and never imports; a test that sees `ready` and no throw has proved
 * the difference between resolving a plugin and running it.
 */

throw new Error('the explodes fixture throws when imported');

export const name = 'explodes';
