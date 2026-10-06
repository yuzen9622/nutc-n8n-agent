export const successResponse = (data: unknown) => ({success: true, data});
export const errorResponse = (code: string) => ({success: false, error: {code}});
