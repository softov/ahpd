#!/usr/bin/env node
/**
 * A plugin that takes its time to apply.
 *
 * The loader awaits each `apply` in turn, so a plugin that waits hands the
 * event loop back while the plugins listed before it are still working. That
 * is what a real one does - a vault reading its store, an agent scanning a
 * folder - and it is what decides whether a plugin asking the host something
 * while it applies gets an answer or a "not yet".
 *
 * The wait is real time, so a test that drives this is not one faking a clock.
 */

export const name = 'ahpd-slow';

export const apply = async (host) => {
  await new Promise((resolve) => { setTimeout(resolve, 600); });
  host.log('ahpd-slow: applied');
};