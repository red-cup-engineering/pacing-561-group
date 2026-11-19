/**
 * pacing.561.group's whole server-side surface: hand every request to the
 * Workers Assets binding for public/. There is no other server logic --
 * no accounts, no database, no analytics -- every biometric observation
 * this app touches lives in the requesting browser's own storage and
 * never reaches this Worker at all.
 */
export default {
  /**
   * @param {Request} request
   * @param {{ASSETS: {fetch: (req: Request) => Promise<Response>}}} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
