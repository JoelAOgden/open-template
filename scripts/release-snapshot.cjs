// Called only by the release-branch workflow, after manifest validation.
module.exports = async function createReleaseSnapshot({ github, context, version, runAttempt }) {
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/release') {
    throw new Error('Release snapshots can only originate from a push to release.');
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error('Invalid release version.');
  }
  const branch = `releases/${version}`;
  async function refOrNull(ref) {
    try { return (await github.rest.git.getRef({ ...context.repo, ref })).data; }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  if (await refOrNull(`tags/v${version}`)) throw new Error(`v${version} already exists. Bump the version in a new release PR.`);
  const existing = await refOrNull(`heads/${branch}`);
  if (existing) {
    if (existing.object.sha !== context.sha) throw new Error(`${branch} already points to another commit; it will not be overwritten.`);
    if (!(Number(runAttempt) > 1)) throw new Error(`${branch} already exists. Retry the original failed run or bump the version.`);
  } else {
    await github.rest.git.createRef({ ...context.repo, ref: `refs/heads/${branch}`, sha: context.sha });
  }
  return { version, branch, commit: context.sha };
};
