// netlify/functions/create-qa-report.js
const axios = require('axios');

exports.handler = async (event, context) => {
    console.log('Function called with:', event.httpMethod);
    
    // CORS 헤더
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // OPTIONS 요청 처리 (CORS preflight)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { affectedVersion, pageTitle } = JSON.parse(event.body);
        console.log('Request data:', { affectedVersion, pageTitle });
        
        if (!affectedVersion) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'AffectedVersion is required' })
            };
        }

        // 환경변수에서 Confluence 인증 정보 가져오기
        const confluenceEmail = process.env.CONFLUENCE_EMAIL;
        const confluenceToken = process.env.CONFLUENCE_API_TOKEN;

        if (!confluenceEmail || !confluenceToken) {
            console.error('Missing environment variables');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error' })
            };
        }

        console.log('Using email:', confluenceEmail);

        // Confluence API 인증 설정
        const auth = {
            username: confluenceEmail,
            password: confluenceToken
        };

        const baseUrl = 'https://overdare.atlassian.net/wiki/rest/api';

        // 1. 템플릿 페이지 내용 가져오기
        console.log('Fetching template page...');
        const templateResponse = await axios.get(
            `${baseUrl}/content/42008650?expand=body.storage`,
            {
                auth,
                headers: {
                    'Accept': 'application/json',
                    'X-Atlassian-Token': 'no-check'
                },
                timeout: 10000 // 10초 타임아웃
            }
        );

        console.log('Template page fetched successfully');
        let templateContent = templateResponse.data.body.storage.value;

        // 2. JQL에서 affectedVersion 교체
        const originalVersion = 'ovdr-6116';
        templateContent = templateContent.replace(new RegExp(originalVersion, 'g'), affectedVersion);
        console.log(`JQL updated: ${originalVersion} → ${affectedVersion}`);

        // 3. 새 페이지 생성
        const finalTitle = pageTitle || `${affectedVersion} Report`;
        console.log(`Creating page: ${finalTitle}`);

        const createPayload = {
            type: 'page',
            title: finalTitle,
            space: { key: 'NFTMetaverse' },
            parent: { id: '29698636' }, // QA Report 페이지 ID
            body: {
                storage: {
                    value: templateContent,
                    representation: 'storage'
                }
            }
        };

        const createResponse = await axios.post(
            `${baseUrl}/content`,
            createPayload,
            {
                auth,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Atlassian-Token': 'no-check'
                },
                timeout: 15000 // 15초 타임아웃
            }
        );

        const newPageData = createResponse.data;
        const pageUrl = `https://overdare.atlassian.net/wiki${newPageData._links.webui}`;
        
        console.log(`Page created successfully: ${pageUrl}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                pageUrl: pageUrl,
                pageTitle: finalTitle,
                pageId: newPageData.id
            })
        };

    } catch (error) {
        console.error('Error creating QA Report:', error);
        
        let errorMessage = 'Failed to create QA Report';
        let statusCode = 500;

        if (error.response) {
            // API 응답 오류
            errorMessage = error.response.data?.message || `HTTP ${error.response.status}: ${error.response.statusText}`;
            statusCode = error.response.status;
            console.error('API Error Response:', error.response.data);
        } else if (error.request) {
            // 네트워크 오류
            errorMessage = 'Network error - unable to connect to Confluence';
            console.error('Network Error:', error.message);
        } else {
            // 기타 오류
            errorMessage = error.message;
            console.error('General Error:', error.message);
        }

        return {
            statusCode: statusCode,
            headers,
            body: JSON.stringify({
                error: errorMessage,
                details: error.response?.data || error.message
            })
        };
    }
};
