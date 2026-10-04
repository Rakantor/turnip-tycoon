import { createApp } from './app';

export default {
  fetch(request, env, ctx) {
    return createApp(env.HYPERDRIVE.connectionString).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
