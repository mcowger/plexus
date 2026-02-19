export interface BuildInfo {
    version: string;
    buildSha: string | null;
    buildTime: string | null;
    startedAt: string;
    displayVersion: string;
}

const startedAt = new Date().toISOString();

const normalize = (value: string | undefined): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const shortSha = (sha: string | null): string | null => {
    if (!sha) return null;
    return sha.length > 7 ? sha.slice(0, 7) : sha;
};

export const getBuildInfo = (): BuildInfo => {
    const version = normalize(process.env.APP_VERSION) || 'dev';
    const buildSha = normalize(process.env.APP_BUILD_SHA);
    const buildTime = normalize(process.env.APP_BUILD_TIME);
    const shaSuffix = shortSha(buildSha);

    return {
        version,
        buildSha,
        buildTime,
        startedAt,
        displayVersion: shaSuffix ? `${version}+${shaSuffix}` : version,
    };
};
