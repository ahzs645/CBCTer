# Branch integration into main

All local branches and all remote branch heads were reviewed before integration.

| Branch | Reviewed tip | Decision |
| --- | --- | --- |
| `feat/dental-case-workflows` | `495d902` | Merged tooth review, case restoration, mobile/desktop controls and complete case exports. |
| `feat/native-chunked-scan-packages` | `cd4b0bc` | Included through the dental branch: lossless native chunks, bounded streaming and vendor geometry. |
| `claude/code-review-bugs-O8AnB` | `a47935a` | Merged GPU resource disposal, stable selection callback, remote download/probe fixes, ROI bounds, exact STL triangle counts, owner-recency index and consistent local deletion timestamps. |
| `claude/2-5d-method-alternatives-ytqb1s` | `768dff9` | Merged the research plan with an explicit note that its proposals and historical sample figures are not newly validated functionality. |
| `claude/mere-cbct-handoff` | `9f50abb` | Already on remote main; preserved the embedding protocol and origin checks. |
| `work` | `8a97dbf` | Already an ancestor; no additional changes to bring. |

Merge conflicts were resolved to retain streaming native packages and the remote
binary probe fix, and to dispose both tooth meshes and FDI label textures.
The viewer hook retains both case state and embedded-folder loading. Commit
ancestry checks show zero missing commits from every reviewed branch tip.

Validation of the combined implementation:

- 175 unit tests passed; four opt-in vendor tests skip in the default run.
- 19 browser tests passed, including desktop/touch-phone case editing, native
  OneVolume/Sidexis streaming, export/reopen and a complete case passed from an
  embedding app. Two real-inference tests skipped because scan/model inputs are absent.
- Lint and production compilation passed. The GitHub Pages sub-path build is
  checked separately before pushing.
- The previous native case round-trip checks remain documented in
  [dental-case.md](dental-case.md); test inputs and generated vendor cases stay
  outside the repository.

Real model accuracy and physical iOS/Android performance remain unverified.
The Convex owner index change takes effect with the normal backend deployment;
the GitHub Pages workflow deploys the frontend.
