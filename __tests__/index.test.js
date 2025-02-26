const { describe, it, beforeEach, afterEach, mock, expect } = require('jest');
const http = require('http');
const fs = require('fs');

// Mock Node.js modules
jest.mock('fs');
jest.mock('http');

// Store original console methods
const originalConsole = { ...console };

// Setup test file for CPU temperature
const setupMockTempFile = (tempValue) => {
  fs.readFile.mockImplementation((path, encoding, callback) => {
    if (path === "/sys/class/thermal/thermal_zone0/temp") {
      callback(null, `${tempValue}`);
    } else {
      callback(new Error(`File not found: ${path}`));
    }
  });
};

describe('Temperature Monitor API', () => {
  let server;
  let consoleLogSpy;
  let consoleErrorSpy;
  let consoleWarnSpy;
  let consoleDebugSpy;
  
  beforeEach(() => {
    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    
    // Mock environment variables
    process.env.protocol = 'http';
    process.env.hostname = 'testhost';
    process.env.port = '9999';
    process.env.base_url = '/api/temp';
    process.env.max_retries = '3';
    process.env.scrape_interval = '5000';
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock HTTP server
    const mockServer = {
      listen: jest.fn((port, callback) => callback()),
      close: jest.fn(callback => callback())
    };
    http.createServer.mockReturnValue(mockServer);
    server = mockServer;
    
    // Mock static files
    fs.readFileSync.mockImplementation((path) => {
      return Buffer.from('mock content');
    });
    
    // Setup default mock temp file
    setupMockTempFile('42000');
    
    // Require the module under test (this will execute the file)
    jest.isolateModules(() => {
      require('../index.js');
    });
  });
  
  afterEach(() => {
    // Restore console
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.debug = originalConsole.debug;
    
    // Clear environment
    delete process.env.protocol;
    delete process.env.hostname;
    delete process.env.port;
    delete process.env.base_url;
    delete process.env.max_retries;
    delete process.env.scrape_interval;
    
    // Clear require cache
    jest.resetModules();
  });
  
  describe('Server initialization', () => {
    it('should start the server on the configured port', () => {
      expect(server.listen).toHaveBeenCalledWith('9999', expect.any(Function));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Temperature monitoring API started')
      );
    });
    
    it('should load static assets', () => {
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('/dist/chart.js'));
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('/test.html'));
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('/favicon.ico'));
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('/style.css'));
    });
    
    it('should perform an initial temperature reading on startup', () => {
      expect(fs.readFile).toHaveBeenCalledWith(
        '/sys/class/thermal/thermal_zone0/temp',
        'utf8',
        expect.any(Function)
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Initial temperature reading successful')
      );
    });
  });
  
  describe('readCpuTemp function', () => {
    it('should correctly read and parse CPU temperature', async () => {
      // Get a reference to the readCpuTemp function
      const readCpuTemp = jest.requireActual('../index.js').readCpuTemp;
      
      setupMockTempFile('45600');
      const temp = await readCpuTemp();
      expect(temp).toBe(45.6);
    });
    
    it('should handle file read errors', async () => {
      // Get a reference to the readCpuTemp function
      const readCpuTemp = jest.requireActual('../index.js').readCpuTemp;
      
      // Mock fs.readFile to simulate an error
      fs.readFile.mockImplementation((path, encoding, callback) => {
        callback(new Error('Mock read error'));
      });
      
      await expect(readCpuTemp()).rejects.toThrow('Mock read error');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read temperature file')
      );
    });
    
    it('should handle invalid temperature values', async () => {
      // Get a reference to the readCpuTemp function
      const readCpuTemp = jest.requireActual('../index.js').readCpuTemp;
      
      // Mock invalid temperature
      setupMockTempFile('not a number');
      
      await expect(readCpuTemp()).rejects.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing temperature data')
      );
    });
    
    it('should use cached data when available and fresh', async () => {
      // Get a reference to the readCpuTemp function
      const readCpuTemp = jest.requireActual('../index.js').readCpuTemp;
      
      // First call to establish cache
      setupMockTempFile('45600');
      await readCpuTemp();
      
      // Change the mock but shouldn't read again due to cache
      setupMockTempFile('50000');
      fs.readFile.mockClear();
      
      await readCpuTemp();
      expect(fs.readFile).not.toHaveBeenCalled();
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using cached temperature data'),
        expect.any(Object)
      );
    });
  });
  
  describe('HTTP Server', () => {
    let requestHandler;
    let mockRequest;
    let mockResponse;
    
    beforeEach(() => {
      // Extract the request handler function
      requestHandler = http.createServer.mock.calls[0][0];
      
      // Create mock request and response objects
      mockRequest = {
        url: '/api/temp',
        method: 'GET',
        socket: { remoteAddress: '127.0.0.1' }
      };
      
      mockResponse = {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn()
      };
    });
    
    it('should handle root endpoint request', () => {
      // Setup mock
      setupMockTempFile('38500');
      
      // Call handler
      requestHandler(mockRequest, mockResponse);
      
      // Verify response
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        200, 
        expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' })
      );
      
      // Extract the callback passed to readFile
      const callback = fs.readFile.mock.calls[0][2];
      callback(null, '38500');
      
      expect(mockResponse.end).toHaveBeenCalledWith(JSON.stringify({ temp: 38.5 }));
    });
    
    it('should handle /ping endpoint', () => {
      mockRequest.url = '/api/temp/ping';
      
      requestHandler(mockRequest, mockResponse);
      
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        200, 
        expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' })
      );
      expect(mockResponse.write).toHaveBeenCalledWith(JSON.stringify({ status: 'UP' }));
      expect(mockResponse.end).toHaveBeenCalled();
    });
    
    it('should handle /metrics endpoint', () => {
      mockRequest.url = '/api/temp/metrics';
      
      requestHandler(mockRequest, mockResponse);
      
      // Extract the callback passed to readFile
      const callback = fs.readFile.mock.calls[0][2];
      callback(null, '75300');
      
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        200, 
        expect.objectContaining({ 'Content-Type': 'text/plain' })
      );
      expect(mockResponse.end).toHaveBeenCalledWith(
        expect.stringContaining('cpu_temperature 75.3')
      );
    });
    
    it('should handle static assets', () => {
      mockRequest.url = '/api/temp/chart.js';
      
      requestHandler(mockRequest, mockResponse);
      
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        200, 
        expect.objectContaining({ 'Content-Type': 'text/javascript; charset=utf-8' })
      );
      expect(mockResponse.write).toHaveBeenCalled();
      expect(mockResponse.end).toHaveBeenCalled();
    });
    
    it('should return 404 for non-existent paths', () => {
      mockRequest.url = '/api/temp/nonexistent';
      
      requestHandler(mockRequest, mockResponse);
      
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        404, 
        expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' })
      );
      expect(mockResponse.end).toHaveBeenCalledWith(JSON.stringify({ temp: null }));
    });
    
    it('should return 405 for non-GET methods', () => {
      mockRequest.method = 'POST';
      
      requestHandler(mockRequest, mockResponse);
      
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        405, 
        expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' })
      );
      expect(mockResponse.end).toHaveBeenCalledWith(JSON.stringify({ temp: null }));
    });
    
    it('should handle temperature read errors', () => {
      mockRequest.url = '/api/temp';
      
      // Mock file read error
      fs.readFile.mockImplementation((path, encoding, callback) => {
        callback(new Error('Mock read error'));
      });
      
      requestHandler(mockRequest, mockResponse);
      
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        500, 
        expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' })
      );
      expect(mockResponse.end).toHaveBeenCalledWith(
        expect.stringContaining('error')
      );
    });
  });
  
  describe('Logger', () => {
    it('should format logs in logfmt format', () => {
      // Extract the logger from the module
      const logger = jest.requireActual('../index.js').logger;
      
      logger.info('Test message', { key: 'value', number: 42 });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/level=info msg="Test message" ts=.* key="value" number=42/)
      );
    });
    
    it('should handle error objects in log fields', () => {
      const logger = jest.requireActual('../index.js').logger;
      const testError = new Error('Test error');
      
      logger.error('Error occurred', { error: testError });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/level=error msg="Error occurred" ts=.* error="Test error"/)
      );
    });
  });
  
  describe('Graceful shutdown', () => {
    it('should close the server on SIGTERM', () => {
      // Simulate SIGTERM
      process.emit('SIGTERM');
      
      expect(server.close).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received SIGTERM, shutting down gracefully')
      );
    });
    
    it('should close the server on SIGINT', () => {
      // Simulate SIGINT
      process.emit('SIGINT');
      
      expect(server.close).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received SIGINT, shutting down gracefully')
      );
    });
  });
});
