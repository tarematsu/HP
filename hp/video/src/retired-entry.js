function retiredResponse() {
  return Response.json({
    ok: false,
    error: 'homepanel-video has been integrated into homepanel-cloud'
  }, {
    status: 410,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export default {
  fetch() {
    return retiredResponse();
  }
};
