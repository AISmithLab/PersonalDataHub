import { Octokit } from 'octokit';

export class GitHubAccessManager {
  private octokit: Octokit;

  constructor(ownerToken: string) {
    this.octokit = new Octokit({ auth: ownerToken });
  }

  /**
   * Grant the agent account access to a repo as a collaborator.
   */
  async grantAccess(agentUsername: string, repo: string, permission: string = 'read'): Promise<void> {
    const [owner, repoName] = repo.split('/');
    await this.octokit.rest.repos.addCollaborator({
      owner,
      repo: repoName,
      username: agentUsername,
      permission: permission as 'pull' | 'push' | 'admin',
    });
  }

  /**
   * Revoke the agent account's access to a repo.
   */
  async revokeAccess(agentUsername: string, repo: string): Promise<void> {
    const [owner, repoName] = repo.split('/');
    await this.octokit.rest.repos.removeCollaborator({
      owner,
      repo: repoName,
      username: agentUsername,
    });
  }

  /**
   * List repos where the agent has been added as a collaborator.
   */
  async listGrantedRepos(agentUsername: string): Promise<string[]> {
    // List all repos accessible to the owner, then filter by collaborator
    // In practice, this would be more sophisticated
    const repos: string[] = [];

    try {
      const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100,
      });

      for (const repo of data) {
        try {
          await this.octokit.rest.repos.checkCollaborator({
            owner: repo.owner.login,
            repo: repo.name,
            username: agentUsername,
          });
          repos.push(repo.full_name);
        } catch {
          // Not a collaborator, skip
        }
      }
    } catch {
      // Ignore errors
    }

    return repos;
  }
}
