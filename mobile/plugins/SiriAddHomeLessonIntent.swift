import AppIntents
import Foundation
import Security

private struct APIEnvelope<Value: Decodable>: Decodable {
  let success: Bool
  let message: String
  let data: Value?
}

private struct SessionTokens: Decodable {
  let accessToken: String
  let refreshToken: String
}

private struct FamilyChild: Decodable {
  let id: String
  let name: String
}

private struct CreatedLesson: Decodable {
  let id: String
  let occurredAt: String?
}

private enum SiriLessonError: LocalizedError {
  case apiUnavailable
  case signInRequired
  case noMatchingChild
  case ambiguousChild
  case invalidAmount
  case requestFailed(String)

  var errorDescription: String? {
    switch self {
    case .apiUnavailable: return "Set the family expense API URL in the iOS build configuration."
    case .signInRequired: return "Sign in to Family Expenses on this iPhone first."
    case .noMatchingChild: return "No child with that name was found in this family."
    case .ambiguousChild: return "More than one child has that name. Use the app to choose the child."
    case .invalidAmount: return "The lesson amount must be greater than zero."
    case .requestFailed(let message): return message
    }
  }
}

struct AddHomeLessonIntent: AppIntent {
  static var title: LocalizedStringResource = "إضافة درس منزلي"
  static var description = IntentDescription("تسجيل درس منزلي لأحد الأطفال مع تكلفته.")
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

  @Parameter(title: "اسم الطفل") var childName: String
  @Parameter(title: "المبلغ") var amount: Double

  func perform() async throws -> some IntentResult {
    guard amount > 0 else { throw SiriLessonError.invalidAmount }
    guard let apiBase = Bundle.main.object(forInfoDictionaryKey: "FAMILY_EXPENSES_API_URL") as? String,
      !apiBase.isEmpty else {
      throw SiriLessonError.apiUnavailable
    }

    let refreshToken = try readRefreshToken()
    let session = try await refreshSession(apiBase: apiBase, refreshToken: refreshToken)
    try writeRefreshToken(session.refreshToken)

    let children: [FamilyChild] = try await request(
      apiBase: apiBase,
      path: "/members/children",
      method: "GET",
      accessToken: session.accessToken
    )
    let matchingChildren = children.filter {
      $0.name.compare(childName.trimmingCharacters(in: .whitespacesAndNewlines), options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }
    guard !matchingChildren.isEmpty else { throw SiriLessonError.noMatchingChild }
    guard matchingChildren.count == 1, let child = matchingChildren.first else { throw SiriLessonError.ambiguousChild }

    let amountText = String(format: "%.3f", locale: Locale(identifier: "en_US_POSIX"), arguments: [amount])
    let timestamp = ISO8601DateFormatter().string(from: Date())
    let _: CreatedLesson = try await request(
      apiBase: apiBase,
      path: "/expenses/home-lessons",
      method: "POST",
      accessToken: session.accessToken,
      body: [
        "childId": child.id,
        "amount": amountText,
        "description": "Home lesson",
        "occurredAt": timestamp,
      ]
    )

    return .result(dialog: "تم تسجيل درس منزلي لـ \(child.name).")
  }
}

struct FamilyExpensesShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddHomeLessonIntent(),
      phrases: [
        "Add a home lesson with \(.applicationName)",
        "Record a lesson with \(.applicationName)",
        "أضف درساً منزلياً في \(.applicationName)",
        "سجل درساً جديداً في \(.applicationName)",
      ],
      shortTitle: "درس منزلي",
      systemImageName: "book.closed"
    )
  }
}

private func refreshSession(apiBase: String, refreshToken: String) async throws -> SessionTokens {
  try await request(
    apiBase: apiBase,
    path: "/auth/refresh",
    method: "POST",
    body: ["refreshToken": refreshToken]
  )
}

private func request<Value: Decodable>(
  apiBase: String,
  path: String,
  method: String,
  accessToken: String? = nil,
  body: [String: String]? = nil
) async throws -> Value {
  let base = apiBase.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  guard let url = URL(string: "\(base)\(path)") else { throw SiriLessonError.apiUnavailable }
  var request = URLRequest(url: url)
  request.httpMethod = method
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  if let accessToken {
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
  }
  if let body {
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
  }

  let (data, response) = try await URLSession.shared.data(for: request)
  guard let httpResponse = response as? HTTPURLResponse else { throw SiriLessonError.apiUnavailable }
  let envelope = try JSONDecoder().decode(APIEnvelope<Value>.self, from: data)
  guard (200..<300).contains(httpResponse.statusCode), envelope.success, let result = envelope.data else {
    throw SiriLessonError.requestFailed(envelope.message)
  }
  return result
}

private func readRefreshToken() throws -> String {
  let key = Data("refreshToken".utf8)
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "familyexpenses.siri:no-auth",
    kSecAttrGeneric as String: key,
    kSecAttrAccount as String: key,
    kSecMatchLimit as String: kSecMatchLimitOne,
    kSecReturnData as String: true,
  ]
  var item: CFTypeRef?
  guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
    let data = item as? Data,
    let token = String(data: data, encoding: .utf8) else {
    throw SiriLessonError.signInRequired
  }
  return token
}

private func writeRefreshToken(_ token: String) throws {
  let key = Data("refreshToken".utf8)
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "familyexpenses.siri:no-auth",
    kSecAttrGeneric as String: key,
    kSecAttrAccount as String: key,
  ]
  let value = Data(token.utf8)
  let updateStatus = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
  if updateStatus == errSecItemNotFound {
    var insert = query
    insert[kSecValueData as String] = value
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
    guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
      throw SiriLessonError.signInRequired
    }
  } else if updateStatus != errSecSuccess {
    throw SiriLessonError.signInRequired
  }
}