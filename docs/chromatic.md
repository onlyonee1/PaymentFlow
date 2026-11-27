# Storybook visual reviews

Run `npm ci` and `npm run storybook` from `frontend` to work on stories.
The Storybook config discovers files named `*.stories.*` under `frontend/src`.

Connect a Chromatic project to this GitHub repository and add its project token
as the `CHROMATIC_PROJECT_TOKEN` Actions secret. The publishing workflow must
be on the default branch before GitHub can trigger it from a Storybook build.
A push to `main` establishes the baseline. Require the Chromatic **UI Tests**
status on `main` in GitHub branch protection or a ruleset. Review and accept
changes in Chromatic to unblock a pull request.

Pull requests, including forks, build Storybook without the project token. The
default-branch publishing workflow downloads the static build and sends it to
Chromatic with the source commit, branch, and repository metadata. Only pushes
to this repository's `main` automatically accept changes into the baseline.

[Chromatic required checks](https://www.chromatic.com/docs/mandatory-pr-checks/)
