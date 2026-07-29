export function detailsForDriftEpisode(details, episodeId) {
  if (!details || !episodeId || details.episode?.id !== episodeId) return null

  return details
}
