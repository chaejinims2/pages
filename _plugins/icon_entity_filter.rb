# frozen_string_literal: true
# icon_codepoints: hex("1F4BB") 또는 직접 문자("🖳") 둘 다 지원
module Jekyll
  module IconEntityFilter
    HEX_LIKE = /\A[\dA-Fa-f,\s]+\z/.freeze

    def icon_entity(val)
      return "" if val.nil?
      s = val.to_s.strip
      return "" if s.empty?
      # hex가 아니면 직접 문자: 뒤에 U+FE0E(텍스트 스타일) 붙여 Safari 포함 단색 표시
      return Jekyll::Utils::SafeString.new(s + "\uFE0E") unless s.match?(HEX_LIKE)
      parts = s.split(",").map { |h| "&#x#{h.strip};" }
      parts << "&#xFE0E;" unless s.include?("FE0E")
      Jekyll::Utils::SafeString.new(parts.join(""))
    end
  end
end
Liquid::Template.register_filter(Jekyll::IconEntityFilter)
