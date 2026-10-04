import { createApp } from './app';

export default {
  fetch(request, env, ctx) {
    if (env.AUTH_MODE !== 'cookie' && env.AUTH_MODE !== 'bearer')
      throw new Error('AUTH_MODE must be cookie or bearer.');
    return createApp(env.HYPERDRIVE.connectionString, {
      credentialMode: env.AUTH_MODE,
      frontendOrigin: env.FRONTEND_ORIGIN,
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
