// @bloctop/shared — shared pure logic modules (types, db, logger, permissions, utils)
export * from './types'
export * from './db'
export { getDatabase, getClientPromise } from './mongodb'
export { logger, createModuleLogger } from './logger'
export type { LogContext } from './logger'
export { ac, roles, canCreateCrag, canEditCrag, canDeleteCrag, canManagePermissions, canAccessEditor, getEditableCragIds } from './permissions'
export { createRequireAuth } from './require-auth'
export type { AuthInfo, AuthInstance } from './require-auth'
export { API_ERROR_CODES, createErrorResponse } from './api-error-codes'
export type { ApiErrorCode } from './api-error-codes'
export { checkRateLimit, BETA_RATE_LIMIT_CONFIG } from './rate-limit'
export type { RateLimitConfig, RateLimitResult } from './rate-limit'
export { getClientIp, sanitizePathSegment } from './request-utils'

// Utility modules
export { IMAGE_VERSION, getRouteTopoUrl, getCragCoverUrl, getFaceTopoUrl, getTopoImageUrl } from './constants'
export { gradeColors, getGradeColor } from './tokens'
export { cn } from './utils'
export { parseGrade, compareGrades, vToFont, computeGradeRange, formatGradeRange } from './grade-utils'
export {
  DEFAULT_CITY_ID, CITY_COOKIE_NAME, CITY_COOKIE_MAX_AGE,
  findCityById, findCityName, isCityValid, isCityAvailable,
  findPrefectureByDistrictId, findCityByAdcode, findNearestCity,
  parseCitySelection, serializeCitySelection,
} from './city-utils'
export { catmullRomCurve, scalePoints, normalizePoint, generateRouteColor, generateRouteId } from './topo-utils'
export {
  TOPO_VIEW_WIDTH, TOPO_VIEW_HEIGHT, computeViewBox,
  TOPO_LINE_CONFIG, TOPO_MARKER_CONFIG, TOPO_ANIMATION_CONFIG, TOPO_MULTI_LINE_CONFIG,
} from './topo-constants'
export {
  BETA_PLATFORMS, extractUrlFromText, isXiaohongshuUrl, isXiaohongshuShortUrl, detectPlatformFromUrl, extractXiaohongshuNoteId, normalizeXiaohongshuNoteUrl,
} from './beta-constants'
export {
  V_GRADES, GRADE_GROUPS, getGradesByValue, getGradesByValues,
  FILTER_PARAMS, DEFAULT_SORT_DIRECTION, SEARCH_PLACEHOLDER,
} from './filter-constants'
export type { SortDirection } from './filter-constants'
export { getSiblingRoutes } from './route-utils'
export { getCragTheme } from './crag-theme'
export type { CragTheme } from './crag-theme'
export { VIEW_WIDTH, VIEW_HEIGHT, GRADE_OPTIONS, preloadImage } from './editor-utils'
export { deriveAreas, getPersistedAreas } from './editor-areas'
export { revalidateCragPages, revalidateHomePage } from './revalidate-helpers'
export { matchRouteByQuery, filterRoutesByQuery } from './route-search'
export type { MatchType, MatchInfo } from './route-search'
