Generate release notes for version ${{ inputs.tag }}.
Read the file `github_changes.tmp.json` in the current directory. It contains an array
of commits between the previous and current release tags, each with:
- sha: the commit SHA
- fullMessage: the full commit message (multiline)
- shortMessage: the first line of the commit message
- author: the commit author name
- date: the commit date (ISO 8601)
- url: the commit URL on GitHub
- pr: the associated PR info (number, title, body, url, author, labels, merged_at) or null if directly committed

Use ONLY this data — do not look up additional history.

---

## FORMAT

The release notes must follow this structure, in this order, with no additional sections:

1. **Title** — A single H2 heading using this pattern:
   ## 🚀 Plexus v[X.Y.Z]

2. **Release Date** — A bolded line immediately below the title:
   **Release Date:** [Month DD, YYYY]

3. **Overview** — An H3 section with a short narrative (3-5 sentences) that:
   - Summarizes the theme or biggest impact of the release
   - Explains why users should care
   - Thanks contributors or the community if appropriate
   - Does NOT simply repeat the bullet points that follow

4. **Breaking Changes** — An H3 section (⚠️ icon) that calls out any
   backwards-incompatible changes. Each bullet should:
   - Clearly state what changed and what the impact is
   - Link to a migration guide or workaround if one exists
   - Reference the PR or issue number in parentheses at the end
   If there are NO breaking changes, omit this entire section entirely. Do not include the heading with an empty list.

5. **New Features** — An H3 section (🆕 icon) listing new capabilities. Each bullet should:
   - Bold the feature name, followed by an em dash, then a one-sentence description
   - Reference the PR or issue number in parentheses at the end
   - Example: **Feature Name** — Description of the feature. (#1234)

6. **Bug Fixes** — An H3 section (🐛 icon) listing resolved issues. Each bullet should:
   - Start with "Fixed", "Resolved", or "Corrected"
   - Briefly describe the bug and its fix
   - Reference the PR or issue number in parentheses at the end
   - Example: Fixed an issue where [description of bug]. (#5678)

7. **Other Changes** — An H3 section (📦 icon) for deprecations, dependency updates, internal improvements, or anything that doesn't fit above. Same bullet format as the other sections.

8. **Contributors** — An H3 section (🙏 icon) listing the people who contributed, prefixed with @. Format as a comma-separated line:
   Thanks to the following people who contributed to this release:
   @username1, @username2, @username3

---

## RULES

- Do NOT add sections not listed above (no Upgrade Instructions, no Links, no FAQ, etc.).
- Breaking Changes comes immediately after Overview, before New Features.
- If a section has no items, omit the section and its heading entirely — do not leave an empty section.
- Every bullet must end with a PR or issue number in parentheses, e.g. (#1234), unless the input provides none.
- Keep the narrative overview concise (3-5 sentences). It should read like a human wrote it, not an automated log.
- Use consistent tense: present tense for features ("Adds"), past tense for fixes ("Fixed").
- Do not use the header divider (---) between sections; only use it after the title/date block and after the overview.