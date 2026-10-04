export default {
  fetch() {
    return Response.json({ status: 'ok' });
  },
} satisfies ExportedHandler<Env>;
