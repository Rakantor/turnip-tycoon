import { createApp } from './app';
import { sweep } from './sweep';

export default {
  fetch(request, env, ctx) {
    if (env.AUTH_MODE !== 'cookie' && env.AUTH_MODE !== 'bearer')
      throw new Error('AUTH_MODE must be cookie or bearer.');
    return createApp(env.HYPERDRIVE.connectionString, {
      credentialMode: env.AUTH_MODE,
      frontendOrigin: env.FRONTEND_ORIGIN,
      rateLimits: {
        profiles: env.PROFILE_LIMIT,
        client: env.CLIENT_LIMIT,
        creation: env.CREATION_LIMIT,
      },
    }).fetch(request, env, ctx);
  },
  async scheduled(controller, env) {
    try {
      const report = await sweep(env.HYPERDRIVE.connectionString);
      console.log(JSON.stringify({ event: 'sweep_completed', cron: controller.cron, ...report }));
    } catch (error) {
      // As for requests, keep only the error's name. The next run picks up where this one failed.
      console.error(
        JSON.stringify({
          event: 'sweep_failed',
          name: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;
